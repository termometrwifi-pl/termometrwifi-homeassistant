"""Integracja TermometrWifi dla Home Assistant."""
from __future__ import annotations

import json
import logging
import os

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TermometrWifiClient
from .const import (
    CONF_API_KEY,
    CONF_BASE_URL,
    CONF_SCAN_INTERVAL,
    DEFAULT_BASE_URL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
)
from .coordinator import TermometrWifiCoordinator
from .realtime import TermometrWifiRealtime
from .services import async_setup_services, async_unload_services
from .weather import WeatherPusher

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.NUMBER,
    Platform.SELECT,
    Platform.SWITCH,
    Platform.BUTTON,
    Platform.IMAGE,
]

# Pliki frontendu serwowane z integracji (auto-rejestrowane jako zasoby — bez ręcznego dodawania URL):
#  - karta Lovelace (ładowana na wszystkich dashboardach),
#  - vendorowany widget z aplikacji (styl "modern"; kartę doładowuje sama na żądanie).
CARD_FILENAME = "termometrwifi-smoker-card.js"
WIDGET_FILENAME = "widget-smoker.js"
CARD_URL = f"/{DOMAIN}/{CARD_FILENAME}"
WIDGET_URL = f"/{DOMAIN}/{WIDGET_FILENAME}"


def _cache_bust_token() -> str:
    """Token cache-bustingu = najnowszy mtime plików frontendu.

    Zmienia się automatycznie po każdej edycji karty/widgetu (bez ręcznego bumpowania wersji),
    a nie zmienia przy zwykłym restarcie — więc przeglądarka pobiera świeży plik tylko gdy trzeba.
    """
    base = os.path.join(os.path.dirname(__file__), "www")
    newest = 0.0
    for name in (CARD_FILENAME, WIDGET_FILENAME):
        try:
            newest = max(newest, os.path.getmtime(os.path.join(base, name)))
        except OSError:
            pass
    return str(int(newest)) if newest else _read_version()


def _read_version() -> str:
    """Wersja integracji z manifestu (fallback dla cache-bustingu)."""
    try:
        with open(os.path.join(os.path.dirname(__file__), "manifest.json"), encoding="utf-8") as fh:
            return json.load(fh).get("version", "0")
    except (OSError, ValueError):
        return "0"


async def _async_register_card(hass: HomeAssistant) -> None:
    """Serwuje pliki karty + widgetu i ładuje kartę na wszystkich dashboardach."""
    if hass.data.get(f"{DOMAIN}_card_registered"):
        return
    base = os.path.join(os.path.dirname(__file__), "www")
    files = [(CARD_URL, CARD_FILENAME), (WIDGET_URL, WIDGET_FILENAME)]
    paths = []
    for url, name in files:
        full = os.path.join(base, name)
        if not os.path.isfile(full):
            _LOGGER.warning("Nie znaleziono pliku frontendu: %s", full)
            continue
        paths.append((url, full))

    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(url, full, cache_headers=False) for url, full in paths]
        )
    except (ImportError, AttributeError):  # starsze wersje HA
        for url, full in paths:
            hass.http.register_static_path(url, full, cache_headers=False)

    # Cache-busting: token (mtime plików) w query wymusza pobranie świeżego JS po zmianie karty.
    token = await hass.async_add_executor_job(_cache_bust_token)
    versioned = f"{CARD_URL}?v={token}"

    # Preferujemy prawdziwy zasób Lovelace (widoczny w UI, niezawodny na aplikacji mobilnej).
    # Gdy się nie uda (tryb YAML / brak kolekcji) — fallback na add_extra_js_url.
    registered = await _async_register_lovelace_resource(hass, versioned)
    if not registered:
        try:
            add_extra_js_url(hass, versioned)
            _LOGGER.info("Karta TermometrWifi załadowana przez add_extra_js_url (%s).", versioned)
        except Exception:  # noqa: BLE001 — rejestracja zasobu nie może wywalić setupu
            _LOGGER.warning("Nie udało się zarejestrować zasobu karty: %s", versioned)

    hass.data[f"{DOMAIN}_card_registered"] = True


async def _async_register_lovelace_resource(hass: HomeAssistant, versioned_url: str) -> bool:
    """Rejestruje kartę jako zasób Lovelace (res_type=module). True gdy obsłużone.

    Działa tylko w trybie storage (dashboardy zarządzane z UI). W trybie YAML zwraca False —
    wtedy używamy add_extra_js_url, a użytkownik może dodać zasób ręcznie.
    """
    data = hass.data.get("lovelace")
    resources = getattr(data, "resources", None)
    if resources is None and isinstance(data, dict):
        resources = data.get("resources")
    # ResourceYAMLCollection nie ma async_create_item → brak możliwości zapisu.
    if resources is None or not hasattr(resources, "async_create_item"):
        return False
    try:
        if not getattr(resources, "loaded", False):
            await resources.async_load()
            resources.loaded = True
        for item in resources.async_items():
            url = str(item.get("url", ""))
            if url.split("?")[0].endswith(CARD_FILENAME):
                if url != versioned_url:  # podbij token przy zmianie pliku
                    await resources.async_update_item(item["id"], {"url": versioned_url})
                    _LOGGER.info("Zaktualizowano zasób karty TermometrWifi → %s", versioned_url)
                return True
        await resources.async_create_item({"res_type": "module", "url": versioned_url})
        _LOGGER.info("Dodano zasób Lovelace karty TermometrWifi: %s", versioned_url)
        return True
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Rejestracja zasobu Lovelace nie powiodła się: %s", err)
        return False


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Konfiguruje wpis: tworzy klienta + coordinator i ładuje platformy."""
    client = TermometrWifiClient(
        async_get_clientsession(hass),
        entry.data.get(CONF_BASE_URL, DEFAULT_BASE_URL),
        entry.data[CONF_API_KEY],
    )
    scan_interval = entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
    coordinator = TermometrWifiCoordinator(hass, client, scan_interval, entry)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await _async_register_card(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Usługi (upload zdjęcia do AI, masa/ilość) — raz globalnie.
    await async_setup_services(hass)

    # Realtime push (MQTT-WS). Niepowodzenie nie blokuje setupu — zostaje polling.
    realtime = TermometrWifiRealtime(hass, client, coordinator)
    hass.data[DOMAIN][f"{entry.entry_id}_realtime"] = realtime
    await realtime.async_start()

    # Push lokalnej pogody (HA → APP) — działa tylko gdy wskazano encje w opcjach.
    pusher = WeatherPusher(hass, entry, client)
    hass.data[DOMAIN][f"{entry.entry_id}_weather"] = pusher
    await pusher.async_start()

    # Zmiana opcji (encje pogody / interwał) → przeładuj wpis.
    entry.async_on_unload(entry.add_update_listener(_async_reload_entry))
    return True


async def _async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Usuwa wpis i jego platformy."""
    realtime = hass.data[DOMAIN].pop(f"{entry.entry_id}_realtime", None)
    if realtime:
        await realtime.async_stop()
    pusher = hass.data[DOMAIN].pop(f"{entry.entry_id}_weather", None)
    if pusher:
        pusher.async_stop()
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        async_unload_services(hass)
    return unload_ok
