"""Sensory TermometrWifi.

Wędzarnia (smoker): kuratorowany zestaw encji (temperatury, status, etap, czas, moc grzałki,
sygnał WiFi) — diagnostyka firmware (ZC/HZ/gamma/PID/limity) jest pomijana.
Pozostałe urządzenia: zachowane dotychczasowe dynamiczne sensory per topic.
"""
from __future__ import annotations

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    DOMAIN,
    SMOKER_HEATER_WINDOW,
    SMOKER_PHASES,
    SMOKER_SENSORS,
)
from .coordinator import TermometrWifiCoordinator
from .entity import (
    TermometrWifiSmokerEntity,
    device_info,
    device_values,
    friendly_name,
    is_smoker,
    resolve_suffix,
    to_number,
    ts_to_iso,
)

_DEVICE_CLASSES = {
    "temperature": SensorDeviceClass.TEMPERATURE,
    "duration": SensorDeviceClass.DURATION,
    "signal_strength": SensorDeviceClass.SIGNAL_STRENGTH,
}

# Suffiksy obsłużone przez kuratorowane encje smokera (sensor + sterowanie) —
# pomijamy je w fallbacku, żeby nie dublować.
_SMOKER_HANDLED = {s[0].lower() for s in SMOKER_SENSORS} | {
    "pub/tdm", "pub/twm", "pub/dym", "pub/fan1", "pub/fan2", "pub/led", "pub/prog",
    "pub/occw", "pub/oscw", "pub/wcw", "pub/pcw",
    "pub/trw", "pub/tsw", "pub/tww", "pub/tpw", "pub/twmw",
}


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Tworzy sensory ze snapshotu (nowe encje dochodzą na bieżąco, bez restartu)."""
    coordinator: TermometrWifiCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    @callback
    def _discover() -> None:
        new: list[SensorEntity] = []
        for sn, dev in (coordinator.data or {}).get("devices", {}).items():
            values = dev.get("values") or {}
            if is_smoker(values):
                for read_suffix, key, name, unit, dclass, prec in SMOKER_SENSORS:
                    if resolve_suffix(values, read_suffix) is None:
                        continue
                    uid = f"{sn}::{key}"
                    if uid in known:
                        continue
                    known.add(uid)
                    new.append(
                        SmokerSensor(coordinator, sn, key, read_suffix, name, unit, dclass, prec)
                    )
            else:
                # Fallback: dotychczasowe dynamiczne sensory per topic dla nie-wędzarni.
                for suffix in values:
                    uid = f"{sn}::raw::{suffix}"
                    if uid in known:
                        continue
                    known.add(uid)
                    new.append(TermometrWifiSensor(coordinator, sn, suffix))
        if new:
            async_add_entities(new)

    _discover()
    entry.async_on_unload(coordinator.async_add_listener(_discover))


class SmokerSensor(TermometrWifiSmokerEntity, SensorEntity):
    """Kuratorowany sensor wędzarni — liczbowy (z precyzją) lub tekstowy."""

    def __init__(self, coordinator, sn, key, read_suffix, name, unit, dclass, prec) -> None:
        super().__init__(coordinator, sn, key, read_suffix)
        self._attr_unique_id = f"{DOMAIN}_{sn}_{key}"
        self._attr_name = name
        self._prec = prec
        if unit:
            self._attr_native_unit_of_measurement = unit
        if dclass in _DEVICE_CLASSES:
            self._attr_device_class = _DEVICE_CLASSES[dclass]
        if prec is not None:
            self._attr_state_class = SensorStateClass.MEASUREMENT
            self._attr_suggested_display_precision = prec

    @property
    def native_value(self):
        raw = self._raw()
        if raw is None:
            return None
        # Etap (AKTUAL): liczba → nazwa fazy.
        if self._key == "phase":
            idx = to_number(raw)
            if idx is None:
                return str(raw)
            i = int(idx)
            return SMOKER_PHASES[i] if 0 <= i < len(SMOKER_PHASES) else str(i)
        # Tekst (status, przepis, czas, tryb).
        if self._prec is None:
            return str(raw)
        num = to_number(raw)
        if num is None:
            return None
        # Moc grzałki: duty 0..WindowSize → %.
        if self._key == "heater":
            return round(num / SMOKER_HEATER_WINDOW * 100, 0)
        return num

    @property
    def extra_state_attributes(self):
        # Etap: udostępniamy surowy indeks fazy (karta Lovelace rysuje z niego pasek faz).
        if self._key == "phase":
            idx = to_number(self._raw())
            return {"index": int(idx) if idx is not None else None}
        return None


class TermometrWifiSensor(CoordinatorEntity[TermometrWifiCoordinator], SensorEntity):
    """Pojedyncza surowa wartość MQTT (fallback dla urządzeń innych niż wędzarnia)."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: TermometrWifiCoordinator, sn: str, suffix: str) -> None:
        super().__init__(coordinator)
        self._sn = sn
        self._suffix = suffix
        self._attr_unique_id = f"{DOMAIN}_{sn}_{suffix}"
        self._attr_name = friendly_name(suffix)
        if to_number(self._raw()) is not None:
            self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def device_info(self):
        return device_info(self.coordinator, self._sn)

    def _entry(self):
        return device_values(self.coordinator, self._sn).get(self._suffix)

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
