"""Stałe integracji TermometrWifi."""
from __future__ import annotations

DOMAIN = "termometrwifi"

CONF_BASE_URL = "base_url"
CONF_API_KEY = "api_key"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_BASE_URL = "https://termometrwifi.pl/wp-json/iot/v1"
DEFAULT_SCAN_INTERVAL = 30  # sekundy (API: rate limit 120/min, zalecane 30-60 s)
MIN_SCAN_INTERVAL = 15

MANUFACTURER = "TermometrWifi"
