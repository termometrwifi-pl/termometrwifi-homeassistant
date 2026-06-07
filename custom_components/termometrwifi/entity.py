"""Wspólne helpery encji TermometrWifi."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MANUFACTURER, SMOKER_MARKER_SUFFIXES


def device_info(coordinator, sn: str) -> DeviceInfo:
    """DeviceInfo dla sterownika (jedno urządzenie HA per SN)."""
    dev = (coordinator.data or {}).get("devices", {}).get(sn, {})
    return DeviceInfo(
        identifiers={(DOMAIN, sn)},
        name=dev.get("name") or sn,
        manufacturer=MANUFACTURER,
        model=dev.get("category") or None,
        sw_version=dev.get("fw_version"),
    )


def friendly_name(suffix: str) -> str:
    """Topic suffix → czytelna nazwa encji (np. 'PUB/KOMORA' → 'Komora')."""
    s = suffix
    for prefix in ("PUB/", "SUB/", "pub/", "sub/"):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    s = s.replace("/", " ").replace("_", " ").strip()
    return s.title() if s else suffix


def to_number(value):
    """Zwraca float gdy wartość jest liczbą, inaczej None."""
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None


def ts_to_iso(ts):
    """Unix ts → ISO8601 (UTC). None gdy brak."""
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def device_values(coordinator, sn: str) -> dict:
    """Mapa raw {suffix: {v, ts}} dla danego sterownika."""
    return (
        (coordinator.data or {})
        .get("devices", {})
        .get(sn, {})
        .get("values", {})
    ) or {}


def resolve_suffix(values: dict, wanted: str) -> str | None:
    """Znajduje rzeczywisty klucz suffiksu w `values` (case-insensitive).

    Firmware używa mieszanej wielkości liter (PUB/T/tDym, PUB/przepis, PUB/ocCW…),
    a admin może je nadpisać — dlatego dopasowujemy bez uwzględniania wielkości liter.
    """
    if wanted in values:
        return wanted
    low = wanted.lower()
    for key in values:
        if key.lower() == low:
            return key
    return None


def is_smoker(values: dict) -> bool:
    """True gdy urządzenie wygląda na wędzarnię (ma charakterystyczne topiki temperatur)."""
    return any(resolve_suffix(values, m) is not None for m in SMOKER_MARKER_SUFFIXES)


def _raw_value(values: dict, suffix: str):
    key = resolve_suffix(values, suffix)
    if key is None:
        return None
    entry = values.get(key)
    return entry.get("v") if isinstance(entry, dict) else None


def device_online(values: dict) -> bool:
    """Czy sterownik jest online.

    MQTT jest retained → po rozłączeniu zostają nieaktualne wartości. Obecność wykrywamy z LWT:
    firmware ustawia Last Will na PUB/Czas = "OFF LINE" (retained). Dodatkowo honorujemy topic
    `status` (online/offline/1/0), jeśli kiedyś się pojawi. Brak sygnału = zakładamy online.
    """
    status = _raw_value(values, "status")
    if status is not None:
        s = str(status).strip().lower()
        if s in ("offline", "off line", "off", "0", "false"):
            return False
        if s in ("online", "on", "1", "true"):
            return True
    czas = _raw_value(values, "PUB/Czas")
    if czas is not None and re.search(r"off\s*line", str(czas), re.IGNORECASE):
        return False
    return True


class TermometrWifiSmokerEntity(CoordinatorEntity):
    """Baza encji wędzarni — wspólne device_info, dostęp do wartości i publikacja komend."""

    _attr_has_entity_name = True

    def __init__(self, coordinator, sn: str, key: str, read_suffix: str | None) -> None:
        super().__init__(coordinator)
        self._sn = sn
        self._key = key
        self._read_suffix = read_suffix

    @property
    def device_info(self) -> DeviceInfo:
        return device_info(self.coordinator, self._sn)

    def _values(self) -> dict:
        return device_values(self.coordinator, self._sn)

    def _raw(self, suffix: str | None = None):
        """Surowa wartość spod (rozwiązanego) suffiksu lub None."""
        values = self._values()
        suffix = suffix or self._read_suffix
        if not suffix:
            return None
        actual = resolve_suffix(values, suffix)
        if actual is None:
            return None
        entry = values.get(actual)
        return entry.get("v") if isinstance(entry, dict) else None

    @property
    def available(self) -> bool:
        if not super().available:
            return False
        # Offline (LWT) → encje wędzarni niedostępne, żeby nie pokazywać starych retained wartości.
        if not device_online(self._values()):
            return False
        if self._read_suffix is None:
            return True
        return self._raw() is not None

    async def _publish(
        self, write_suffix: str, payload: str, echo_suffix: str | None = None
    ) -> None:
        """Wyślij komendę na SUB/* i odśwież dane (optymistycznie + realny poll)."""
        await self.coordinator.async_send_command(
            self._sn, write_suffix, payload, echo_suffix or self._read_suffix
        )
