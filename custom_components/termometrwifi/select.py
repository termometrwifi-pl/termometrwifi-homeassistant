"""Wybór programu wędzarni (PUB/PROG ↔ SUB/PROG)."""
from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SMOKER_PROGRAMS, SMOKER_SELECT
from .coordinator import TermometrWifiCoordinator
from .entity import TermometrWifiSmokerEntity, is_smoker, resolve_suffix


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: TermometrWifiCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()
    read_s, write_s, key, name = SMOKER_SELECT

    @callback
    def _discover() -> None:
        new: list[SmokerProgramSelect] = []
        for sn, dev in (coordinator.data or {}).get("devices", {}).items():
            values = dev.get("values") or {}
            if not is_smoker(values) or resolve_suffix(values, read_s) is None:
                continue
            uid = f"{sn}::sel::{key}"
            if uid in known:
                continue
            known.add(uid)
            new.append(SmokerProgramSelect(coordinator, sn, key, read_s, write_s, name))
        if new:
            async_add_entities(new)

    _discover()
    entry.async_on_unload(coordinator.async_add_listener(_discover))


class SmokerProgramSelect(TermometrWifiSmokerEntity, SelectEntity):
    """Program sterownika jako lista wyboru."""

    _attr_options = SMOKER_PROGRAMS

    def __init__(self, coordinator, sn, key, read_s, write_s, name) -> None:
        super().__init__(coordinator, sn, key, read_s)
        self._write_suffix = write_s
        self._attr_unique_id = f"{DOMAIN}_{sn}_sel_{key}"
        self._attr_name = name

    @property
    def current_option(self):
        raw = self._raw()
        if raw is None:
            return None
        val = str(raw).strip().upper()
        return val if val in SMOKER_PROGRAMS else None

    async def async_select_option(self, option: str) -> None:
        await self._publish(self._write_suffix, option)
