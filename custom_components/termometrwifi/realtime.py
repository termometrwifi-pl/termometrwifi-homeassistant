"""Realtime push dla TermometrWifi przez MQTT-over-WebSocket (EMQX).

Dodatek NIE trzyma żadnych stałych danych MQTT — przy każdym połączeniu pobiera krótkotrwały
JWT (subscribe-only, ACL tylko na własne SN-y) oraz adres brokera z `GET /ha/mqtt-credentials`.
JWT jest rotowany przed wygaśnięciem. Sterowanie nadal idzie przez `/ha/command` (publish po
stronie serwera) — token jest tylko do odczytu.

Gdy paho-mqtt lub broker są nieosiągalne, integracja po cichu działa dalej na samym pollingu.
"""
from __future__ import annotations

import logging
import time
from urllib.parse import urlparse

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

try:
    import paho.mqtt.client as mqtt
except ImportError:  # pragma: no cover
    mqtt = None

from .api import TermometrWifiApiError, TermometrWifiClient

_LOGGER = logging.getLogger(__name__)

KEEPALIVE = 45
RECONNECT_DELAY = 30  # s — ponowna próba po błędzie/utracie połączenia
REFRESH_MARGIN = 120  # s — odśwież JWT na tyle przed wygaśnięciem


class TermometrWifiRealtime:
    """Zarządza połączeniem MQTT-WS i wstrzykuje odebrane wartości do coordinatora."""

    def __init__(self, hass: HomeAssistant, client: TermometrWifiClient, coordinator) -> None:
        self._hass = hass
        self._client = client
        self._coordinator = coordinator
        self._mqttc = None
        self._topics: list[str] = []
        self._stopping = False
        self._cancel_refresh = None
        self._cancel_retry = None

    @property
    def available(self) -> bool:
        return mqtt is not None

    async def async_start(self) -> None:
        if mqtt is None:
            _LOGGER.info("paho-mqtt niedostępne — realtime wyłączony, działa polling.")
            return
        self._stopping = False
        await self._connect()

    async def async_stop(self) -> None:
        self._stopping = True
        for cancel in (self._cancel_refresh, self._cancel_retry):
            if cancel:
                cancel()
        self._cancel_refresh = self._cancel_retry = None
        await self._teardown_client()

    async def _teardown_client(self) -> None:
        c, self._mqttc = self._mqttc, None
        if c is None:
            return

        def _close():
            try:
                c.disconnect()
            except Exception:  # noqa: BLE001
                pass
            try:
                c.loop_stop()
            except Exception:  # noqa: BLE001
                pass

        await self._hass.async_add_executor_job(_close)

    async def _connect(self) -> None:
        if self._stopping:
            return
        await self._teardown_client()
        try:
            creds = await self._client.async_get_mqtt_credentials()
        except TermometrWifiApiError as err:
            _LOGGER.warning("Realtime: nie udało się pobrać poświadczeń (%s) — retry za %ss", err, RECONNECT_DELAY)
            self._schedule_retry()
            return

        url = str(creds.get("url") or "")
        parsed = urlparse(url)
        host = parsed.hostname
        if not host:
            _LOGGER.warning("Realtime: brak/niepoprawny URL brokera (%s)", url)
            self._schedule_retry()
            return
        secure = parsed.scheme in ("wss", "https")
        port = parsed.port or (443 if secure else 80)
        path = parsed.path or "/mqtt"
        self._topics = list(creds.get("topics") or [])

        client_id = f"ha-{int(time.time() * 1000) & 0xFFFFFF}"
        username = creds.get("username")
        password = creds.get("password")

        # Cała budowa klienta paho (Client(), tls_set, connect_async, loop_start) w EXECUTORZE —
        # tls_set() ładuje certyfikaty systemowe (blokujące I/O), więc nie może być w pętli zdarzeń.
        def _build_and_start():
            try:
                c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id, transport="websockets")
            except (AttributeError, TypeError):  # paho 1.x
                c = mqtt.Client(client_id=client_id, transport="websockets")
            c.ws_set_options(path=path)
            if secure:
                c.tls_set()
            c.username_pw_set(username, password)
            c.on_connect = self._on_connect
            c.on_message = self._on_message
            c.on_disconnect = self._on_disconnect
            c.connect_async(host, port, keepalive=KEEPALIVE)
            c.loop_start()
            return c

        try:
            self._mqttc = await self._hass.async_add_executor_job(_build_and_start)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Realtime: błąd połączenia (%s) — retry za %ss", err, RECONNECT_DELAY)
            self._schedule_retry()
            return

        # Rotacja JWT przed wygaśnięciem.
        exp = int(creds.get("expires") or 0)
        delay = max(60, exp - int(time.time()) - REFRESH_MARGIN) if exp else 3000
        if self._cancel_refresh:
            self._cancel_refresh()
        self._cancel_refresh = async_call_later(self._hass, delay, self._on_refresh)
        _LOGGER.debug("Realtime: połączono, %d topików, odświeżenie JWT za %ss", len(self._topics), delay)

    def _schedule_retry(self) -> None:
        if self._stopping or self._cancel_retry:
            return

        @callback
        def _retry(_now):
            self._cancel_retry = None
            self._hass.async_create_task(self._connect())

        self._cancel_retry = async_call_later(self._hass, RECONNECT_DELAY, _retry)

    @callback
    def _on_refresh(self, _now) -> None:
        self._cancel_refresh = None
        self._hass.async_create_task(self._connect())

    # ── Callbacki paho (wątek MQTT) — marshalujemy do pętli HA ──
    def _on_connect(self, client, *args) -> None:
        # VERSION2: (client, userdata, flags, reason_code, properties); v1: (client, userdata, flags, rc)
        rc = args[2] if len(args) >= 3 else None
        ok = (rc is None) or (getattr(rc, "is_failure", None) is False) or (rc == 0)
        if not ok:
            _LOGGER.warning("Realtime: CONNACK niepowodzenie (rc=%s) — sprawdź broker/JWT", rc)
            return
        for topic in self._topics:
            try:
                client.subscribe(topic, qos=0)
            except Exception:  # noqa: BLE001
                pass
        _LOGGER.info("Realtime: połączono, subskrypcja %d topików: %s", len(self._topics), self._topics)

    def _on_message(self, client, userdata, msg, *args) -> None:
        try:
            topic = msg.topic
            payload = msg.payload.decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            return
        sn, _, suffix = topic.partition("/")
        if not suffix:
            return
        # realtime_update jest @callback (sync) — add_job uruchomi go bezpiecznie w pętli HA.
        self._hass.add_job(self._coordinator.realtime_update, sn, suffix, payload)

    def _on_disconnect(self, client, *args) -> None:
        if self._stopping:
            return
        _LOGGER.debug("Realtime: rozłączono — ponowna próba za %ss", RECONNECT_DELAY)
        self._schedule_retry()
