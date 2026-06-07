# TermometrWifi — integracja Home Assistant

Custom integration dla [Home Assistant](https://www.home-assistant.io/), która pobiera dane Twoich
sterowników z **termometrwifi.pl** przez bezpieczne API (klucz) i tworzy w HA:

- **urządzenie** dla każdego sterownika (np. wędzarnia, destylator),
- **wędzarnia** → kuratorowany, czytelny zestaw encji (temperatury, status, etap, program, nastawy)
  oraz **sterowanie** (START/STOP, wybór programu, cele temperatur, dym, wentylatory, światło),
- **inne sterowniki** → encje (sensory) dla każdej wartości MQTT,
- **binary_sensor „Alarm"** (klasa *problem*) dla każdego sterownika z listą aktywnych alarmów,
- **dedykowaną kartę Lovelace** „TermometrWifi — Wędzarnia" (auto-rejestrowana, bez ręcznego dodawania zasobu).

Dane MQTT nie są udostępniane — HA łączy się wyłącznie przez HTTPS, kluczem API (polling + komendy).

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
| **Wędzarnia — sensory** | Komora, Wsad (°C), Etap, Status, Przepis, Czas, Czas trwania/całkowity, Moc grzałki (%), Sygnał WiFi |
| **Wędzarnia — sterowanie** | `number`: Cel komory/wsadu, Generator dymu, Wentylator 1/2, parametry programu WLASNY · `select`: Program · `switch`: Światło · `button`: Start/Stop |
| Inne sterowniki — sensor per topic | wartość liczbowa → `measurement`; tekstowa → string. Atrybuty: `topic`, `last_seen` |
| `binary_sensor` Alarm | ON gdy aktywny alarm; atrybuty: lista aktywnych alarmów (nazwa, ważność, czas) |

Diagnostyka firmware wędzarni (ZC, HZ, gamma, nastawy PID, limity TRIAC) jest **pomijana** — w HA
pojawiają się tylko encje potrzebne i widoczne na karcie. Nowe wartości na sterownikach innych niż
wędzarnia są dodawane jako encje automatycznie (bez restartu).

## Karta Lovelace „Wędzarnia"

Integracja sama rejestruje kartę — wystarczy dodać ją do dashboardu:

```yaml
type: custom:termometrwifi-smoker-card
# device_id: opcjonalnie — domyślnie pierwsza wędzarnia integracji
```

Karta sama wyszukuje encje urządzenia (komora/wsad z celami, program, START/STOP, slidery
dym/wentylatory, światło). Po instalacji może być konieczne **odświeżenie przeglądarki**
(Ctrl+F5), żeby HA wczytał nowy zasób frontendu.

## Sterowanie — bezpieczeństwo

Komendy idą przez `POST /ha/command` (auth tym samym kluczem API) — backend publikuje na MQTT,
klient nie dostaje dostępu do brokera. Akcje destrukcyjne (reset WiFi/fabryczny, OTA) są zablokowane
po stronie serwera. Limit: 30 komend/min na klucz.

## Odpytywanie i limity

Domyślny interwał: **30 s** (API: limit 120 zapytań/min na klucz). Polling pobiera `GET /ha/state`
oraz `GET /ha/alarms` w jednym cyklu.

## Dokumentacja API

Pełny opis endpointów: [`docs/api.md`](https://github.com/termometrwifi-pl/termometrwifiapk/blob/main/docs/api.md)
w repozytorium głównym.

## Status

v0.2.0 — odczyt (sensory + alarmy) **oraz sterowanie wędzarnią** (nastawy, program, START/STOP,
dym/wentylatory/światło) + dedykowana karta Lovelace. Wymaga backendu z endpointem `POST /ha/command`.
