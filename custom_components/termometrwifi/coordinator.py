"""DataUpdateCoordinator dla TermometrWifi — jeden poll /ha/state + /ha/alarms."""
from __future__ import annotations

import logging
import time
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
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

    async def _async_update_data(self) -> dict:
        try:
            state = await self.client.async_get_state()
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

        return {"devices": devices, "alarms": alarms_by_sn}

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
