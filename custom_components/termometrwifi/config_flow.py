"""Config flow — adres API + klucz."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TermometrWifiApiError, TermometrWifiAuthError, TermometrWifiClient
from .const import CONF_API_KEY, CONF_BASE_URL, DEFAULT_BASE_URL, DOMAIN

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
