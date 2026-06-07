"""Encje image: zdjęcie załadunku i wyrobu ostatniego cyklu wędzarni.

Integracja pobiera bajty zdjęcia swoim kluczem API (server-side) i serwuje je lokalnie w HA —
plik nie jest nigdy publiczny, a w karcie używasz zwykłego `picture`/`image`.
"""
from __future__ import annotations

from homeassistant.components.image import ImageEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .api import TermometrWifiApiError
from .const import DOMAIN
from .coordinator import TermometrWifiCoordinator
from .entity import device_info, device_values, is_smoker

# which → (nazwa encji, klucz flagi w danych cyklu)
_PHOTOS = [
    ("start", "Zdjęcie załadunku", "has_start_photo"),
    ("product", "Zdjęcie wyrobu", "has_photo"),
]


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: TermometrWifiCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    @callback
    def _discover() -> None:
        new: list[TermometrWifiRunImage] = []
        for sn, dev in (coordinator.data or {}).get("devices", {}).items():
            if not is_smoker(dev.get("values") or {}):
                continue
            for which, name, flag in _PHOTOS:
                uid = f"{sn}::img::{which}"
                if uid in known:
                    continue
                known.add(uid)
                new.append(TermometrWifiRunImage(hass, coordinator, sn, which, name, flag))
        if new:
            async_add_entities(new)

    _discover()
    entry.async_on_unload(coordinator.async_add_listener(_discover))


class TermometrWifiRunImage(CoordinatorEntity[TermometrWifiCoordinator], ImageEntity):
    """Zdjęcie z ostatniego cyklu (start|product)."""

    _attr_has_entity_name = True
    _attr_content_type = "image/jpeg"

    def __init__(self, hass, coordinator, sn, which, name, flag) -> None:
        CoordinatorEntity.__init__(self, coordinator)
        ImageEntity.__init__(self, hass)
        self._sn = sn
        self._which = which
        self._flag = flag
        self._attr_name = name
        self._attr_unique_id = f"{DOMAIN}_{sn}_photo_{which}"
        self._last_key = None
        self._attr_image_last_updated = dt_util.utcnow()

    @property
    def device_info(self):
        return device_info(self.coordinator, self._sn)

    def _run(self) -> dict | None:
        return self.coordinator.latest_run(self._sn)

    def _has_photo(self) -> bool:
        run = self._run()
        return bool(run and run.get(self._flag))

    @property
    def available(self) -> bool:
        return super().available and self._has_photo()

    @callback
    def _handle_coordinator_update(self) -> None:
        run = self._run() or {}
        key = (run.get("id"), self._has_photo())
        if key != self._last_key:
            self._last_key = key
            self._attr_image_last_updated = dt_util.utcnow()
        super()._handle_coordinator_update()

    async def async_image(self) -> bytes | None:
        run = self._run()
        if not run or not run.get("id") or not self._has_photo():
            return None
        try:
            return await self.coordinator.client.async_get_run_photo(run["id"], self._which)
        except TermometrWifiApiError:
            return None
