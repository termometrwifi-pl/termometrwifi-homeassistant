# TermometrWifi — integracja Home Assistant

Custom integration dla [Home Assistant](https://www.home-assistant.io/), która pobiera dane Twoich
sterowników z **termometrwifi.pl** przez bezpieczne API (klucz) i tworzy w HA:

- **urządzenie** dla każdego sterownika (np. wędzarnia, destylator),
- **encje (sensory)** dla każdej wartości MQTT sterownika (temperatury, statusy, wyjścia…),
- **binary_sensor „Alarm"** (klasa *problem*) dla każdego sterownika z listą aktywnych alarmów.

Dane MQTT nie są udostępniane — HA łączy się wyłącznie przez HTTPS, kluczem API (polling).

## Wymagania

- Home Assistant 2024.1+
- Konto na termometrwifi.pl z co najmniej jednym sterownikiem
- **Klucz API** wygenerowany w aplikacji: **Ustawienia → Home Assistant → Utwórz klucz**

## Instalacja

### HACS (zalecane)
1. HACS → Integrations → ⋮ → *Custom repositories*.
2. Dodaj `https://github.com/termometrwifi-pl/termometrwifi-homeassistant` (kategoria: *Integration*).
3. Zainstaluj „TermometrWifi" i zrestartuj Home Assistant.

### Ręcznie
Skopiuj katalog `custom_components/termometrwifi` do `config/custom_components/` w swojej instalacji HA
i zrestartuj.

## Konfiguracja

1. *Ustawienia → Urządzenia i usługi → Dodaj integrację → TermometrWifi*.
2. Podaj:
   - **Adres API**: `https://termometrwifi.pl/wp-json/iot/v1` (domyślne),
   - **Klucz API**: skopiowany z aplikacji.
3. Integracja zweryfikuje klucz i utworzy urządzenia + encje.

## Co powstaje w HA

| Element | Opis |
|---|---|
| Urządzenie per sterownik | `name` + `model` (kategoria) + `sw_version` (firmware) |
| Sensor per wartość MQTT | wartość liczbowa → `measurement` (wykresy); tekstowa → string. Atrybuty: `topic`, `last_seen` |
| `binary_sensor` Alarm | ON gdy aktywny alarm; atrybuty: lista aktywnych alarmów (nazwa, ważność, czas) |

Nowe wartości pojawiające się na sterowniku są dodawane jako encje automatycznie (bez restartu).

## Odpytywanie i limity

Domyślny interwał: **30 s** (API: limit 120 zapytań/min na klucz). Polling pobiera `GET /ha/state`
oraz `GET /ha/alarms` w jednym cyklu.

## Dokumentacja API

Pełny opis endpointów: [`docs/api.md`](https://github.com/termometrwifi-pl/termometrwifiapk/blob/main/docs/api.md)
w repozytorium głównym.

## Status

v0.1.0 — tylko odczyt (sensory + alarmy). Sterowanie z HA planowane w kolejnym etapie.
