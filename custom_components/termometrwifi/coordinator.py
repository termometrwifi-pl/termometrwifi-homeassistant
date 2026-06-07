"""DataUpdateCoordinator dla TermometrWifi — jeden poll /ha/state + /ha/alarms."""
from __future__ import annotations

import logging
import time
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import TermometrWifiApiError, TermometrWifiAuthError, TermometrWifiClient
from .const import DOMAIN
from .entity import resolve_suffix

_LOGGER = logging.getLogger(__name__)


class TermometrWifiCoordinator(DataUpdateCoordinator):
    """Pobiera stan wszystkich sterowników + alarmy w jednym cyklu."""

    def __init__(
        self,
        hass: HomeAssistant,
        client: TermometrWifiClient,
        scan_interval: int,
        entry: ConfigEntry,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=scan_interval),
        )
        self.client = client
        self.entry = entry
        self._rt_flush_cancel = None

    async def _async_update_data(self) -> dict:
        try:
            # force=True → świeże zebranie z brokera (mniejszy lag dla zmian spoza HA, np. w aplikacji).
            state = await self.client.async_get_state(force=True)
            alarms = await self.client.async_get_alarms()
        except TermometrWifiAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except TermometrWifiApiError as err:
            raise UpdateFailed(str(err)) from err

        devices = {d["sn"]: d for d in state.get("devices", []) if d.get("sn")}

        alarms_by_sn: dict[str, list] = {}
        for alarm in alarms.get("alarms", []):
            sn = alarm.get("sn")
            if sn:
                alarms_by_sn.setdefault(sn, []).append(alarm)

        # Cykle (analiza AI + zdjęcia + wsad) — best-effort; błąd nie wywala całego cyklu.
        runs: list = []
        runs_by_sn: dict[str, dict] = {}
        try:
            runs = (await self.client.async_get_runs(limit=12)).get("runs", [])
            for run in runs:
                sn = run.get("sn")
                if sn and sn not in runs_by_sn:  # lista posortowana malejąco → pierwszy = najnowszy
                    runs_by_sn[sn] = run
        except TermometrWifiApiError as err:
            _LOGGER.debug("Pobranie cykli nie powiodło się: %s", err)
            prev = self.data or {}
            runs = prev.get("runs", [])
            runs_by_sn = prev.get("runs_by_sn", {})

        return {
            "devices": devices,
            "alarms": alarms_by_sn,
            "runs": runs,
            "runs_by_sn": runs_by_sn,
        }

    def latest_run(self, sn: str) -> dict | None:
        """Najnowszy cykl danego sterownika (lub None)."""
        return (self.data or {}).get("runs_by_sn", {}).get(sn)

    async def async_send_command(
        self, sn: str, suffix: str, payload: str, echo_suffix: str | None = None
    ) -> None:
        """Publikuje komendę sterującą; opcjonalnie aktualizuje lokalny stan optymistycznie.

        echo_suffix — topic PUB, który firmware odeśle po przyjęciu komendy. Ustawiamy go od
        razu, żeby encja zareagowała natychmiast (realny poll i tak zweryfikuje wartość).
        """
        try:
            await self.client.async_command(sn, suffix, str(payload))
        except TermometrWifiAuthError as err:
            raise HomeAssistantError(f"Brak uprawnień do sterowania: {err}") from err
        except TermometrWifiApiError as err:
            raise HomeAssistantError(f"Komenda nie powiodła się: {err}") from err

        if echo_suffix and self.data:
            values = (
                self.data.get("devices", {}).get(sn, {}).get("values")
            )
            if isinstance(values, dict):
                actual = resolve_suffix(values, echo_suffix) or echo_suffix
                values[actual] = {"v": str(payload), "ts": int(time.time())}
                self.async_set_updated_data(self.data)

        await self.async_request_refresh()

    @callback
    def realtime_update(self, sn: str, suffix: str, value: str) -> None:
        """Wartość z kanału realtime (MQTT-WS) → lokalny stan + odroczone powiadomienie encji."""
        if not self.data:
            return
        dev = self.data.get("devices", {}).get(sn)
        if not dev:
            return  # urządzenie pojawi się przy najbliższym pollingu
        values = dev.setdefault("values", {})
        actual = resolve_suffix(values, suffix) or suffix
        values[actual] = {"v": str(value), "ts": int(time.time())}
        # Debounce: firmware publikuje wiele topików naraz — scalamy w jedno powiadomienie.
        if self._rt_flush_cancel is None:
            self._rt_flush_cancel = async_call_later(self.hass, 0.3, self._rt_flush)

    @callback
    def _rt_flush(self, _now) -> None:
        self._rt_flush_cancel = None
        self.async_set_updated_data(self.data)
