"""Przełącznik światła wędzarni (PUB/LED ↔ SUB/LED, 1/0)."""
from __future__ import annotations

from homeassistant.components.switch import SwitchDeviceClass, SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SMOKER_SWITCH
from .coordinator import TermometrWifiCoordinator
from .entity import TermometrWifiSmokerEntity, is_smoker, resolve_suffix, to_number


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: TermometrWifiCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()
    read_s, write_s, key, name = SMOKER_SWITCH

    @callback
    def _discover() -> None:
        new: list[SmokerLightSwitch] = []
        for sn, dev in (coordinator.data or {}).get("devices", {}).items():
            values = dev.get("values") or {}
            if not is_smoker(values) or resolve_suffix(values, read_s) is None:
                continue
            uid = f"{sn}::sw::{key}"
            if uid in known:
                continue
            known.add(uid)
            new.append(SmokerLightSwitch(coordinator, sn, key, read_s, write_s, name))
        if new:
            async_add_entities(new)

    _discover()
    entry.async_on_unload(coordinator.async_add_listener(_discover))


class SmokerLightSwitch(TermometrWifiSmokerEntity, SwitchEntity):
    """Światło wędzarni — ON=1 / OFF=0."""

    _attr_device_class = SwitchDeviceClass.SWITCH

    def __init__(self, coordinator, sn, key, read_s, write_s, name) -> None:
        super().__init__(coordinator, sn, key, read_s)
        self._write_suffix = write_s
        self._attr_unique_id = f"{DOMAIN}_{sn}_sw_{key}"
        self._attr_name = name

    @property
    def is_on(self) -> bool | None:
        num = to_number(self._raw())
        return None if num is None else num > 0

    async def async_turn_on(self, **kwargs) -> None:
        await self._publish(self._write_suffix, "1")

    async def async_turn_off(self, **kwargs) -> None:
        await self._publish(self._write_suffix, "0")
