"""Wysyłka lokalnej pogody (HA → APP).

Cyklicznie odczytuje wartości ze wskazanych encji (temperatura/wilgotność/wiatr) i wysyła je do
backendu (POST /ha/weather). Worker preferuje te dane nad open-meteo, gdy są świeże.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval

from .api import TermometrWifiApiError, TermometrWifiClient
from .const import (
    CONF_WEATHER_HUMIDITY,
    CONF_WEATHER_TEMP,
    CONF_WEATHER_WIND,
    WEATHER_PUSH_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)


def _num_state(hass: HomeAssistant, entity_id: str | None) -> float | None:
    if not entity_id:
        return None
    state = hass.states.get(entity_id)
    if not state or state.state in ("unknown", "unavailable", ""):
        return None
    try:
        return float(str(state.state).replace(",", "."))
    except (TypeError, ValueError):
        return None


class WeatherPusher:
    """Okresowy push wartości z encji pogodowych do backendu."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: TermometrWifiClient) -> None:
        self._hass = hass
        self._entry = entry
        self._client = client
        self._unsub = None

    def _configured(self) -> bool:
        o = self._entry.options
        return any(o.get(k) for k in (CONF_WEATHER_TEMP, CONF_WEATHER_HUMIDITY, CONF_WEATHER_WIND))

    async def async_start(self) -> None:
        if not self._configured():
            return
        self._unsub = async_track_time_interval(
            self._hass, self._tick, timedelta(seconds=WEATHER_PUSH_INTERVAL)
        )
        await self._push()  # od razu po starcie

    async def _tick(self, _now) -> None:
        await self._push()

    async def _push(self) -> None:
        o = self._entry.options
        body: dict = {}
        temp = _num_state(self._hass, o.get(CONF_WEATHER_TEMP))
        hum = _num_state(self._hass, o.get(CONF_WEATHER_HUMIDITY))
        wind = _num_state(self._hass, o.get(CONF_WEATHER_WIND))
        if temp is not None:
            body["temp_c"] = temp
        if hum is not None:
            body["humidity_pct"] = hum
        if wind is not None:
            body["wind_kph"] = wind
        if not body:
            return
        try:
            await self._client.async_push_weather(body)
        except TermometrWifiApiError as err:
            _LOGGER.debug("Push pogody nie powiódł się: %s", err)

    def async_stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
