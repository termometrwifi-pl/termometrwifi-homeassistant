"""Przyciski START/STOP wędzarni.

STOP zatrzymuje cykl i wraca do trybu MANUAL (jak karta smoker w aplikacji).
"""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SMOKER_BUTTONS
from .coordinator import TermometrWifiCoordinator
from .entity import TermometrWifiSmokerEntity, is_smoker


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: TermometrWifiCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    @callback
    def _discover() -> None:
        new: list[SmokerButton] = []
        for sn, dev in (coordinator.data or {}).get("devices", {}).items():
            values = dev.get("values") or {}
            if not is_smoker(values):
                continue
            for key, name, commands in SMOKER_BUTTONS:
                uid = f"{sn}::btn::{key}"
                if uid in known:
                    continue
                known.add(uid)
                new.append(SmokerButton(coordinator, sn, key, name, commands))
        if new:
            async_add_entities(new)

    _discover()
    entry.async_on_unload(coordinator.async_add_listener(_discover))


class SmokerButton(TermometrWifiSmokerEntity, ButtonEntity):
    """Przycisk publikujący jedną lub kilka komend po kolei."""

    def __init__(self, coordinator, sn, key, name, commands) -> None:
        super().__init__(coordinator, sn, key, None)
        self._commands = commands
        self._attr_unique_id = f"{DOMAIN}_{sn}_btn_{key}"
        self._attr_name = name

    async def async_press(self) -> None:
        for suffix, payload in self._commands:
            await self.coordinator.async_send_command(self._sn, suffix, payload)
