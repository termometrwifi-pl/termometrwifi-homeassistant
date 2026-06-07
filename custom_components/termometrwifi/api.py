"""Klient REST API TermometrWifi (tylko odczyt)."""
from __future__ import annotations

import asyncio
import logging

import aiohttp

_LOGGER = logging.getLogger(__name__)

REQUEST_TIMEOUT = 30


class TermometrWifiApiError(Exception):
    """Ogólny błąd API."""


class TermometrWifiAuthError(TermometrWifiApiError):
    """Nieprawidłowy lub odwołany klucz API."""


class TermometrWifiClient:
    """Mały klient do endpointów /ha/* (auth: klucz API w nagłówku X-API-Key)."""

    def __init__(self, session: aiohttp.ClientSession, base_url: str, api_key: str) -> None:
        self._session = session
        self._base = base_url.rstrip("/")
        self._key = api_key

    @property
    def _headers(self) -> dict[str, str]:
        return {"X-API-Key": self._key, "Accept": "application/json"}

    async def _get(self, path: str) -> dict:
        url = f"{self._base}/{path.lstrip('/')}"
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT):
                resp = await self._session.get(url, headers=self._headers)
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise TermometrWifiApiError(f"Błąd połączenia: {err}") from err

        if resp.status in (401, 403):
            raise TermometrWifiAuthError("Nieprawidłowy lub odwołany klucz API")
        if resp.status == 429:
            raise TermometrWifiApiError("Rate limit (429) — zwiększ interwał odpytywania")
        if resp.status != 200:
            raise TermometrWifiApiError(f"HTTP {resp.status}")
        try:
            return await resp.json()
        except (aiohttp.ContentTypeError, ValueError) as err:
            raise TermometrWifiApiError(f"Niepoprawny JSON: {err}") from err

    async def _post(self, path: str, body: dict) -> dict:
        url = f"{self._base}/{path.lstrip('/')}"
        headers = {**self._headers, "Content-Type": "application/json"}
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT):
                resp = await self._session.post(url, headers=headers, json=body)
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise TermometrWifiApiError(f"Błąd połączenia: {err}") from err

        if resp.status in (401, 403):
            raise TermometrWifiAuthError("Brak uprawnień lub nieprawidłowy klucz API")
        if resp.status == 429:
            raise TermometrWifiApiError("Rate limit (429) — zbyt wiele komend")
        try:
            data = await resp.json()
        except (aiohttp.ContentTypeError, ValueError):
            data = {}
        if resp.status != 200 or not data.get("ok", False):
            raise TermometrWifiApiError(
                f"Komenda odrzucona (HTTP {resp.status}): {data.get('error') or 'błąd'}"
            )
        return data

    async def async_get_devices(self) -> dict:
        """Metadane sterowników (weryfikacja klucza w config flow)."""
        return await self._get("ha/devices")

    async def async_get_state(self) -> dict:
        """Wszystkie sterowniki + komplet wartości MQTT."""
        return await self._get("ha/state")

    async def async_get_alarms(self) -> dict:
        """Ostatnie alarmy użytkownika."""
        return await self._get("ha/alarms?limit=100")

    async def async_command(self, sn: str, suffix: str, payload: str) -> dict:
        """Publikuje komendę sterującą na SN/{suffix} (POST /ha/command)."""
        return await self._post(
            "ha/command", {"sn": sn, "suffix": suffix, "payload": str(payload)}
        )
