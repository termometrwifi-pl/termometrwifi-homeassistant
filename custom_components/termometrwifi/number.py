"""Liczby sterujące wędzarni (nastawy + parametry programu WLASNY).

Czyta wartość z PUB/*, zapisuje na SUB/* przez POST /ha/command.
"""
from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SMOKER_NUMBERS
from .coordinator import TermometrWifiCoordinator
from .entity import TermometrWifiSmokerEntity, is_smoker, resolve_suffix, to_number


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: TermometrWifiCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    @callback
    def _discover() -> None:
        new: list[SmokerNumber] = []
        for sn, dev in (coordinator.data or {}).get("devices", {}).items():
            values = dev.get("values") or {}
            if not is_smoker(values):
                continue
            for read_s, write_s, key, name, unit, lo, hi, step in SMOKER_NUMBERS:
                if resolve_suffix(values, read_s) is None:
                    continue
                uid = f"{sn}::num::{key}"
                if uid in known:
                    continue
                known.add(uid)
                new.append(
                    SmokerNumber(coordinator, sn, key, read_s, write_s, name, unit, lo, hi, step)
                )
        if new:
            async_add_entities(new)

    _discover()
    entry.async_on_unload(coordinator.async_add_listener(_discover))


class SmokerNumber(TermometrWifiSmokerEntity, NumberEntity):
    """Nastawa wędzarni — slider 0–100 % lub pole temperatury/czasu."""

    _attr_mode = NumberMode.AUTO

    def __init__(self, coordinator, sn, key, read_s, write_s, name, unit, lo, hi, step) -> None:
        super().__init__(coordinator, sn, key, read_s)
        self._write_suffix = write_s
        self._attr_unique_id = f"{DOMAIN}_{sn}_num_{key}"
        self._attr_name = name
        self._attr_native_unit_of_measurement = unit
        self._attr_native_min_value = lo
        self._attr_native_max_value = hi
        self._attr_native_step = step
        self._int = float(step).is_integer()

    @property
    def native_value(self):
        return to_number(self._raw())

    async def async_set_native_value(self, value: float) -> None:
        payload = str(int(round(value))) if self._int else f"{value:.2f}"
        await self._publish(self._write_suffix, payload)
