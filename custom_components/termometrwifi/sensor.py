"""Sensory TermometrWifi — encja dla każdej wartości MQTT sterownika."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import TermometrWifiCoordinator
from .entity import device_info, friendly_name, to_number, ts_to_iso


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Dynamiczne tworzenie sensorów ze snapshotu wartości (nowe topiki dochodzą na bieżąco)."""
    coordinator: TermometrWifiCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    @callback
    def _discover() -> None:
        new: list[TermometrWifiSensor] = []
        for sn, dev in (coordinator.data or {}).get("devices", {}).items():
            for suffix in (dev.get("values") or {}):
                uid = f"{sn}::{suffix}"
                if uid in known:
                    continue
                known.add(uid)
                new.append(TermometrWifiSensor(coordinator, sn, suffix))
        if new:
            async_add_entities(new)

    _discover()
    entry.async_on_unload(coordinator.async_add_listener(_discover))


class TermometrWifiSensor(CoordinatorEntity[TermometrWifiCoordinator], SensorEntity):
    """Pojedyncza wartość MQTT (topic suffix) jako encja HA."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: TermometrWifiCoordinator, sn: str, suffix: str) -> None:
        super().__init__(coordinator)
        self._sn = sn
        self._suffix = suffix
        self._attr_unique_id = f"{DOMAIN}_{sn}_{suffix}"
        self._attr_name = friendly_name(suffix)
        # Liczbowa wartość → state_class measurement (wykresy/historia).
        if to_number(self._raw()) is not None:
            self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def device_info(self):
        return device_info(self.coordinator, self._sn)

    def _entry(self):
        return (
            (self.coordinator.data or {})
            .get("devices", {})
            .get(self._sn, {})
            .get("values", {})
            .get(self._suffix)
        )

    def _raw(self):
        e = self._entry()
        return e.get("v") if isinstance(e, dict) else None

    @property
    def available(self) -> bool:
        return super().available and self._entry() is not None

    @property
    def native_value(self):
        raw = self._raw()
        if raw is None:
            return None
        num = to_number(raw)
        return num if num is not None else str(raw)

    @property
    def extra_state_attributes(self):
        e = self._entry() or {}
        return {
            "topic": self._suffix,
            "serial_number": self._sn,
            "raw": e.get("v"),
            "last_seen": ts_to_iso(e.get("ts")),
        }
