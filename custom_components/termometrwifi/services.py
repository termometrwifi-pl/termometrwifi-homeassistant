"""Usługi TermometrWifi: wysyłka zdjęcia do analizy AI + masa/ilość wsadu.

- termometrwifi.upload_run_photo — wyślij zdjęcie (z pliku HA lub z encji kamery) do cyklu,
  tak jak robi to aplikacja po procesie (uruchamia analizę AI).
- termometrwifi.set_load — ustaw masę/ilość/notatkę wsadu (ekran startu w aplikacji).
"""
from __future__ import annotations

import logging
import os

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr

from .const import DOMAIN
from .coordinator import TermometrWifiCoordinator

_LOGGER = logging.getLogger(__name__)

SERVICE_UPLOAD_PHOTO = "upload_run_photo"
SERVICE_SET_LOAD = "set_load"

_CONTENT_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
}

_UPLOAD_SCHEMA = vol.Schema(
    {
        vol.Optional("device_id"): vol.Any(cv.string, [cv.string]),
        vol.Optional("run_id"): vol.Coerce(int),
        vol.Optional("which", default="product"): vol.In(["start", "product"]),
        vol.Optional("image_path"): cv.string,
        vol.Optional("camera_entity"): cv.entity_id,
    }
)

_LOAD_SCHEMA = vol.Schema(
    {
        vol.Optional("device_id"): vol.Any(cv.string, [cv.string]),
        vol.Optional("run_id"): vol.Coerce(int),
        vol.Optional("mass_kg"): vol.Coerce(float),
        vol.Optional("count"): vol.Coerce(int),
        vol.Optional("note"): cv.string,
    }
)


def _coordinators(hass: HomeAssistant) -> list[TermometrWifiCoordinator]:
    return [
        v for v in hass.data.get(DOMAIN, {}).values()
        if isinstance(v, TermometrWifiCoordinator)
    ]


def _sn_from_device(hass: HomeAssistant, device_id) -> str | None:
    if isinstance(device_id, list):
        device_id = device_id[0] if device_id else None
    if not device_id:
        return None
    dev = dr.async_get(hass).async_get(device_id)
    if not dev:
        return None
    for ident in dev.identifiers:
        if ident[0] == DOMAIN:
            return ident[1]
    return None


def _resolve(hass: HomeAssistant, call: ServiceCall) -> tuple[TermometrWifiCoordinator, int]:
    """Zwraca (coordinator, run_id) z device_id (najnowszy cykl) lub jawnego run_id."""
    coords = _coordinators(hass)
    if not coords:
        raise HomeAssistantError("Brak skonfigurowanej integracji TermometrWifi.")

    run_id = call.data.get("run_id")
    if run_id:
        for c in coords:
            for run in (c.data or {}).get("runs", []):
                if run.get("id") == run_id:
                    return c, run_id
        return coords[0], run_id

    sn = _sn_from_device(hass, call.data.get("device_id"))
    if not sn:
        # Jedno urządzenie? weź jego najnowszy cykl.
        for c in coords:
            runs = (c.data or {}).get("runs", [])
            if runs:
                return c, runs[0]["id"]
        raise HomeAssistantError("Podaj device_id lub run_id — nie udało się wskazać cyklu.")
    for c in coords:
        run = c.latest_run(sn)
        if run and run.get("id"):
            return c, run["id"]
    raise HomeAssistantError(f"Brak cyklu dla urządzenia {sn}.")


async def _async_get_image(hass: HomeAssistant, call: ServiceCall) -> tuple[bytes, str, str]:
    """Zwraca (bajty, filename, content_type) z image_path lub camera_entity."""
    path = call.data.get("image_path")
    if path:
        if not os.path.isfile(path):
            raise HomeAssistantError(f"Plik nie istnieje: {path}")
        data = await hass.async_add_executor_job(lambda: open(path, "rb").read())
        ext = os.path.splitext(path)[1].lower()
        return data, os.path.basename(path), _CONTENT_TYPES.get(ext, "image/jpeg")

    cam = call.data.get("camera_entity")
    if cam:
        from homeassistant.components.camera import async_get_image

        image = await async_get_image(hass, cam)
        return image.content, "snapshot.jpg", image.content_type or "image/jpeg"

    raise HomeAssistantError("Podaj image_path albo camera_entity.")


async def async_setup_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_UPLOAD_PHOTO):
        return

    async def _upload(call: ServiceCall) -> None:
        coordinator, run_id = _resolve(hass, call)
        content, filename, content_type = await _async_get_image(hass, call)
        await coordinator.client.async_upload_run_photo(
            run_id, call.data["which"], content, filename, content_type
        )
        await coordinator.async_request_refresh()

    async def _set_load(call: ServiceCall) -> None:
        coordinator, run_id = _resolve(hass, call)
        body: dict = {}
        for key in ("mass_kg", "count", "note"):
            if key in call.data:
                body[key] = call.data[key]
        if not body:
            raise HomeAssistantError("Podaj przynajmniej jedno z: mass_kg, count, note.")
        await coordinator.client.async_set_run_load(run_id, body)
        await coordinator.async_request_refresh()

    hass.services.async_register(DOMAIN, SERVICE_UPLOAD_PHOTO, _upload, schema=_UPLOAD_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SET_LOAD, _set_load, schema=_LOAD_SCHEMA)


def async_unload_services(hass: HomeAssistant) -> None:
    if not _coordinators(hass):
        hass.services.async_remove(DOMAIN, SERVICE_UPLOAD_PHOTO)
        hass.services.async_remove(DOMAIN, SERVICE_SET_LOAD)
