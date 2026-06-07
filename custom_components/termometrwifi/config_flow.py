"""Config flow — adres API + klucz."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TermometrWifiApiError, TermometrWifiAuthError, TermometrWifiClient
from .const import (
    CONF_API_KEY,
    CONF_BASE_URL,
    CONF_SCAN_INTERVAL,
    CONF_WEATHER_HUMIDITY,
    CONF_WEATHER_TEMP,
    CONF_WEATHER_WIND,
    DEFAULT_BASE_URL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    MIN_SCAN_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)


class TermometrWifiConfigFlow(ConfigFlow, domain=DOMAIN):
    """Obsługa dodania integracji przez UI."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            base_url = user_input[CONF_BASE_URL].strip()
            api_key = user_input[CONF_API_KEY].strip()
            client = TermometrWifiClient(
                async_get_clientsession(self.hass), base_url, api_key
            )
            try:
                await client.async_get_devices()
            except TermometrWifiAuthError:
                errors["base"] = "invalid_auth"
            except TermometrWifiApiError:
                errors["base"] = "cannot_connect"
            else:
                # Jeden wpis per klucz (prefix wystarcza do unikalności bez ujawniania klucza).
                await self.async_set_unique_id(api_key[:16])
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title="TermometrWifi",
                    data={CONF_BASE_URL: base_url, CONF_API_KEY: api_key},
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_BASE_URL, default=DEFAULT_BASE_URL): str,
                vol.Required(CONF_API_KEY): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return TermometrWifiOptionsFlow(config_entry)


class TermometrWifiOptionsFlow(OptionsFlow):
    """Opcje: lokalne czujniki pogody (HA → APP) + interwał odpytywania."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            # Puste pola encji → usuwamy (czyszczenie źródła pogody).
            cleaned = {k: v for k, v in user_input.items() if v not in (None, "")}
            return self.async_create_entry(title="", data=cleaned)

        opts = self._entry.options
        sensor_sel = selector.EntitySelector(
            selector.EntitySelectorConfig(domain="sensor")
        )

        def _field(key: str):
            cur = opts.get(key)
            field = vol.Optional(key, description={"suggested_value": cur}) if cur else vol.Optional(key)
            return field

        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_SCAN_INTERVAL,
                    default=opts.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                ): vol.All(vol.Coerce(int), vol.Range(min=MIN_SCAN_INTERVAL, max=600)),
                _field(CONF_WEATHER_TEMP): sensor_sel,
                _field(CONF_WEATHER_HUMIDITY): sensor_sel,
                _field(CONF_WEATHER_WIND): sensor_sel,
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
