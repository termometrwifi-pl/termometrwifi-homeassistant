"""Stałe integracji TermometrWifi + kuratorowany rejestr encji wędzarni (smoker)."""
from __future__ import annotations

DOMAIN = "termometrwifi"

CONF_BASE_URL = "base_url"
CONF_API_KEY = "api_key"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_BASE_URL = "https://termometrwifi.pl/wp-json/iot/v1"
DEFAULT_SCAN_INTERVAL = 30  # sekundy — backstop; bieżące zmiany przychodzą realtime (MQTT-WS)
MIN_SCAN_INTERVAL = 10

MANUFACTURER = "TermometrWifi"

# ── Wędzarnia (smoker) ─────────────────────────────────────────────────────────
# Suffiksy zgodne z firmware wedzarnia_2.0.0 (src/modules/mqtt_comm.cpp:refrMQTT).
# Sterownik publikuje na PUB/*, subskrybuje SUB/*. Karta/encje czytają PUB, piszą SUB.
#
# Decyzja produktowa: tworzymy WYŁĄCZNIE te encje (resztę — ZC/HZ/gamma/SER/PID/limity —
# pomijamy jako diagnostykę). Dopasowanie suffiksu jest case-insensitive (firmware używa
# mieszanej wielkości liter: PUB/T/tDym, PUB/przepis, PUB/ocCW…).

# Program sterownika (publikowane na SUB/PROG).
SMOKER_PROGRAMS = ["MANUAL", "SZYNKA", "KIELBASA", "KRAKOWSKA", "RYBA", "WLASNY", "PRZEPIS"]

# Etapy procesu (PUB/AKTUAL = int). Indeks → czytelna nazwa fazy.
SMOKER_PHASES = [
    "Manual",        # 0
    "Ociekanie",     # 1
    "Rozgrzewanie",  # 2
    "Osuszanie",     # 3
    "Rozpalanie",    # 4
    "Wędzenie",      # 5
    "—",             # 6 (nieużywane)
    "Pieczenie",     # 7
    "Koniec",        # 8
    "+30 min",       # 9
]

# Suffiks używany do rozpoznania, że urządzenie jest wędzarnią (obecny tylko u smokera).
SMOKER_MARKER_SUFFIXES = ("PUB/T/tDym", "PUB/T/tWsad")

# Sensory (read-only). Krotki: (read_suffix, klucz, nazwa, jednostka, device_class, precyzja)
# precyzja=None → tekst; precyzja=int liczba miejsc po przecinku.
SMOKER_SENSORS = [
    ("PUB/T/tDym",  "chamber",   "Komora",          "°C",  "temperature", 1),
    ("PUB/T/tWsad", "meat",      "Wsad",            "°C",  "temperature", 1),
    ("PUB/AKTUAL",  "phase",     "Etap",            None,  None,          None),
    ("PUB/STAT",    "status",    "Status",          None,  None,          None),
    ("PUB/przepis", "recipe",    "Przepis",         None,  None,          None),
    ("PUB/Czas",    "clock",     "Czas",            None,  None,          None),
    ("PUB/elapsed", "elapsed",   "Czas trwania",    "s",   "duration",    0),
    ("PUB/total",   "total",     "Czas całkowity",  "s",   "duration",    0),
    ("PUB/output",  "heater",    "Moc grzałki",     "%",   None,          0),
    ("PUB/signal",  "rssi",      "Sygnał WiFi",     "dBm", "signal_strength", 0),
    ("PUB/CTRL",    "ctrl",      "Tryb sterowania", None,  None,          None),
]

# Sensory z przeliczeniem surowej wartości (np. duty grzałki 0..10000 → %).
SMOKER_HEATER_WINDOW = 10000  # WindowSize firmware (output/WS*100 = duty %)

# Liczby (read PUB / write SUB). Krotki:
# (read_suffix, write_suffix, klucz, nazwa, jednostka, min, max, step)
SMOKER_NUMBERS = [
    ("PUB/TDM",  "SUB/TDM",  "target_chamber", "Cel komory",       "°C", 0, 300, 0.5),
    ("PUB/TWM",  "SUB/TWM",  "target_meat",    "Cel wsadu",        "°C", 0, 300, 0.5),
    ("PUB/DYM",  "SUB/DYM",  "dym",            "Generator dymu",   "%",  0, 100, 1),
    ("PUB/FAN1", "SUB/FAN1", "fan1",           "Wentylator 1",     "%",  0, 100, 1),
    ("PUB/FAN2", "SUB/FAN2", "fan2",           "Wentylator 2",     "%",  0, 100, 1),
    # Parametry programu WLASNY — czasy faz (min) + progi temperatur (°C).
    ("PUB/ocCW", "SUB/ocCW", "w_dripping", "Własny: ociekanie",          "min", 0, 600, 1),
    ("PUB/osCW", "SUB/osCW", "w_drying",   "Własny: osuszanie",          "min", 0, 600, 1),
    ("PUB/wCW",  "SUB/wCW",  "w_smoking",  "Własny: wędzenie",           "min", 0, 600, 1),
    ("PUB/pCW",  "SUB/pCW",  "w_baking",   "Własny: pieczenie",          "min", 0, 600, 1),
    ("PUB/tRW",  "SUB/tRW",  "w_heat",     "Własny: temp. rozgrzewania", "°C",  0, 300, 0.5),
    ("PUB/tSW",  "SUB/tSW",  "w_dry",      "Własny: temp. suszenia",     "°C",  0, 300, 0.5),
    ("PUB/tWW",  "SUB/tWW",  "w_smoke",    "Własny: temp. wędzenia",     "°C",  0, 300, 0.5),
    ("PUB/tPW",  "SUB/tPW",  "w_bake",     "Własny: temp. pieczenia",    "°C",  0, 300, 0.5),
    ("PUB/tWMW", "SUB/tWMW", "w_meat_max", "Własny: temp. wsadu max",    "°C",  0, 300, 0.5),
]

# Select programu (read PUB/PROG, write SUB/PROG).
SMOKER_SELECT = ("PUB/PROG", "SUB/PROG", "program", "Program")

# Przełącznik światła (read PUB/LED, write SUB/LED; 1/0).
SMOKER_SWITCH = ("PUB/LED", "SUB/LED", "light", "Światło")

# Przyciski START/STOP. STOP zatrzymuje cykl i wraca do MANUAL (jak karta w aplikacji).
SMOKER_BUTTONS = [
    ("start", "Start", [("SUB/STAT", "START")]),
    ("stop", "Stop", [("SUB/STAT", "STOP"), ("SUB/PROG", "MANUAL")]),
]
