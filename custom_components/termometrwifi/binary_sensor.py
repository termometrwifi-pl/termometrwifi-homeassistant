"""Binary sensor TermometrWifi — aktywny alarm per sterownik."""
from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.helpers.entity import EntityCategory
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import TermometrWifiCoordinator
from .entity import device_info, device_online, device_values


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Per sterownik: binary_sensor 'Alarm' (problem) + 'Łączność' (connectivity)."""
    coordinator: TermometrWifiCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    @callback
    def _discover() -> None:
        new: list[object] = []
        for sn in (coordinator.data or {}).get("devices", {}):
            if sn in known:
                continue
            known.add(sn)
            new.append(TermometrWifiAlarmBinarySensor(coordinator, sn))
            new.append(TermometrWifiConnectivityBinarySensor(coordinator, sn))
        if new:
            async_add_entities(new)

    _discover()
    entry.async_on_unload(coordinator.async_add_listener(_discover))


def _active_alarms(coordinator: TermometrWifiCoordinator, sn: str) -> list[dict]:
    alarms = (coordinator.data or {}).get("alarms", {}).get(sn, [])
    return [
        a
        for a in alarms
        if int(a.get("value", 0)) == 1 and a.get("status") != "resolved"
    ]


class TermometrWifiAlarmBinarySensor(
    CoordinatorEntity[TermometrWifiCoordinator], BinarySensorEntity
):
    """ON gdy sterownik ma aktywny alarm."""

    _attr_has_entity_name = True
    _attr_name = "Alarm"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, coordinator: TermometrWifiCoordinator, sn: str) -> None:
        super().__init__(coordinator)
        self._sn = sn
        self._attr_unique_id = f"{DOMAIN}_{sn}_alarm"

    @property
    def device_info(self):
        return device_info(self.coordinator, self._sn)

    @property
    def is_on(self) -> bool:
        return len(_active_alarms(self.coordinator, self._sn)) > 0

    @property
    def extra_state_attributes(self):
        active = _active_alarms(self.coordinator, self._sn)
        last = active[0] if active else None
        return {
            "active_count": len(active),
            "last_name": last.get("name") if last else None,
            "last_severity": last.get("severity") if last else None,
            "last_at": last.get("at") if last else None,
            "active": [
                {
                    "name": a.get("name"),
                    "severity": a.get("severity"),
                    "at": a.get("at"),
                    "temperature": a.get("temperature"),
                }
                for a in active
            ],
        }


class TermometrWifiConnectivityBinarySensor(
    CoordinatorEntity[TermometrWifiCoordinator], BinarySensorEntity
):
    """ON gdy sterownik jest online (obecność z SN/status z EMQX; fallback LWT PUB/Czas).

    Pozostaje DOSTĘPNY także offline — w przeciwieństwie do encji wędzarni, które gasną,
    żeby nie pokazywać starych retained wartości. Dzięki temu nadaje się do automatyzacji
    (np. powiadomienie, gdy wędzarnia padnie).
    """

    _attr_has_entity_name = True
    _attr_name = "Łączność"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: TermometrWifiCoordinator, sn: str) -> None:
        super().__init__(coordinator)
        self._sn = sn
        self._attr_unique_id = f"{DOMAIN}_{sn}_status"

    @property
    def device_info(self):
        return device_info(self.coordinator, self._sn)

    @property
    def is_on(self) -> bool:
        return device_online(device_values(self.coordinator, self._sn))
