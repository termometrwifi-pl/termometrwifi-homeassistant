"""Wspólne helpery encji TermometrWifi."""
from __future__ import annotations

from datetime import datetime, timezone

from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN, MANUFACTURER


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
