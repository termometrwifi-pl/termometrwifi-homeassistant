"""Integracja TermometrWifi dla Home Assistant."""
from __future__ import annotations

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

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.NUMBER,
    Platform.SELECT,
    Platform.SWITCH,
    Platform.BUTTON,
]

# Pliki frontendu serwowane z integracji (auto-rejestrowane jako zasoby — bez ręcznego dodawania URL):
#  - karta Lovelace (ładowana na wszystkich dashboardach),
#  - vendorowany widget z aplikacji (styl "modern"; kartę doładowuje sama na żądanie).
CARD_FILENAME = "termometrwifi-smoker-card.js"
WIDGET_FILENAME = "widget-smoker.js"
CARD_URL = f"/{DOMAIN}/{CARD_FILENAME}"
WIDGET_URL = f"/{DOMAIN}/{WIDGET_FILENAME}"


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

    # Ładujemy tylko kartę — widget doładowuje się dynamicznie w trybie "modern".
    try:
        add_extra_js_url(hass, CARD_URL)
    except Exception:  # noqa: BLE001 — rejestracja zasobu nie może wywalić setupu
        _LOGGER.debug("add_extra_js_url nie powiodło się dla %s", CARD_URL)

    hass.data[f"{DOMAIN}_card_registered"] = True


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

    # Realtime push (MQTT-WS). Niepowodzenie nie blokuje setupu — zostaje polling.
    realtime = TermometrWifiRealtime(hass, client, coordinator)
    hass.data[DOMAIN][f"{entry.entry_id}_realtime"] = realtime
    await realtime.async_start()
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Usuwa wpis i jego platformy."""
    realtime = hass.data[DOMAIN].pop(f"{entry.entry_id}_realtime", None)
    if realtime:
        await realtime.async_stop()
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok
