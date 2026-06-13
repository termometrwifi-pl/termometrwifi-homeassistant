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
2. Podaj **Klucz API** skopiowany z aplikacji (adres API jest ustawiany automatycznie).
3. Integracja zweryfikuje klucz i utworzy urządzenia + encje.

## Co powstaje w HA

| Element | Opis |
|---|---|
| Urządzenie per sterownik | `name` + `model` (kategoria) + `sw_version` (firmware) |
| **Wędzarnia — sensory** | Komora, Wsad (°C), Etap, Status, Przepis, Czas, Czas trwania/całkowity, Moc grzałki (%), Sygnał WiFi |
| **Wędzarnia — sterowanie** | `number`: Cel komory/wsadu, Generator dymu, Wentylator 1/2, parametry programu WLASNY · `select`: Program · `switch`: Światło · `button`: Start/Stop |
| Inne sterowniki — sensor per topic | wartość liczbowa → `measurement`; tekstowa → string. Atrybuty: `topic`, `last_seen` |
| `binary_sensor` Alarm | ON gdy aktywny alarm; atrybuty: lista aktywnych alarmów (nazwa, ważność, czas) |
| `binary_sensor` Łączność | connectivity — ON=online (z `SN/status` EMQX / LWT). Dostępny też offline (do automatyzacji) |
| `sensor` Alarm — opis | **treść** alarmu (nazwa aktywnego lub `OK`); atrybuty: severity, lista `active`/`recent` |
| `sensor` Ostatni cykl | program + status; atrybut `ai_feedback` (pełna analiza AI), wsad (`load_mass_kg`/`load_count`), `run_id` |
| `image` Zdjęcie załadunku / wyrobu | zdjęcia ostatniego cyklu (ciągnięte kluczem API, serwowane lokalnie) |

Diagnostyka firmware wędzarni (ZC, HZ, gamma, nastawy PID, limity TRIAC) jest **pomijana** — w HA
pojawiają się tylko encje potrzebne i widoczne na karcie. Nowe wartości na sterownikach innych niż
wędzarnia są dodawane jako encje automatycznie (bez restartu).

## Karta Lovelace „Wędzarnia"

Integracja sama rejestruje kartę — wystarczy dodać ją do dashboardu:

```yaml
type: custom:termometrwifi-smoker-card
style: modern          # "modern" (domyślny, 1:1 widget z aplikacji) lub "classic" (lekki, w stylu HA)
chamber_label: DYM     # etykieta kafelka komory (domyślnie DYM)
meat_label: WSAD       # etykieta kafelka wsadu (domyślnie WSAD)
# device_id: opcjonalnie — domyślnie pierwsza wędzarnia integracji
```

**Dwa style do wyboru:**
- `modern` — vendorowany oryginalny widget z aplikacji (`widget-smoker.js`): wygląd 1:1, wykres
  pełnoekranowy z pan/zoom i tooltipem, modale, edytor programu WLASNY.
- `classic` — lekka karta renderowana w HA (mniej zależności, ten sam zakres sterowania).

Karta odwzorowuje **1:1** wygląd z aplikacji termometrwifi.pl: kafelki komora/wsad (klik = ustaw cel),
wykres temperatur, pasek faz, postęp, chipy (grzałka/etap), kontrolki START/STOP z kłódką, slidery
dym/wentylatory (lub przełączniki w trybie ONOFF), światło oraz edytor programu WLASNY (⚙). Sama
wyszukuje encje urządzenia. Wykres rysuje się na żywo z kolejnych odpytań (rośnie w trakcie sesji).
Po instalacji może być konieczne **odświeżenie przeglądarki** (Ctrl+F5), żeby HA wczytał nowy zasób.

## Karta Lovelace „Kocioł CO" (piec)

Dla sterowników kotła CO (firmware piecv2) integracja rejestruje drugą kartę — wygląd **1:1** z aplikacji:

```yaml
type: custom:termometrwifi-piec-card
# device_id: opcjonalnie — domyślnie pierwszy sterownik z topikami pieca
# sn: opcjonalnie — wskazanie sterownika numerem seryjnym
accent_color: "#F97316"   # opcjonalny kolor akcentu (domyślnie pomarańcz)
title: Kocioł CO          # opcjonalny tytuł
```

Karta vendoruje oryginalny widget z aplikacji (`widget-piec.js`): **schemat hydrauliczny** (kocioł,
płomień, komin ze spalinami, pompa CO, manometr, podajnik/zasobnik), **pasek statusu** (faza · alarmy ·
serwis), **suwak nastawy CO**, **wykres temperatur**, **zasobnik paliwa**, **zużycie 7 dni** oraz panel
**ustawień** (tryb letni, koszt paliwa, krzywa grzewcza, kalibracja czujników, harmonogramy — lokalnie).

Dane czyta z surowych sensorów sterownika (encje per-topic, mapowane po sufiksie topiku → `sn/<suffix>`).
Sterowanie (nastawa, tryb letni, dorzucenie paliwa) publikuje przez usługę `termometrwifi.send_command`.
Po instalacji może być konieczne **odświeżenie przeglądarki** (Ctrl+F5), żeby HA wczytał nowy zasób.

## Cykle, analiza AI i zdjęcia

Integracja pobiera ostatnie cykle (`GET /ha/runs`): program, czasy, status, **analizę AI** (`ai_feedback`)
oraz masę/ilość wsadu. Zdjęcia (załadunek/wyrób) ciągnie kluczem API i serwuje lokalnie jako encje `image`.

**Usługi** (Narzędzia deweloperskie → Usługi lub w automatyzacjach):

- `termometrwifi.upload_run_photo` — wyślij zdjęcie do analizy AI (jak w aplikacji). Źródło: `image_path`
  (plik na HA) lub `camera_entity` (snapshot). `which: start|product`. Cel: `device_id` (najnowszy cykl) lub `run_id`.
- `termometrwifi.set_load` — ustaw `mass_kg` / `count` / `note` wsadu (ekran startu w aplikacji).
- `termometrwifi.send_command` — wyślij surową komendę na sterownik (`SN/{suffix}`). Cel: `device_id`
  lub `sn`. Np. `suffix: cmd/nastaw`, `payload: "65"`. Używana przez kartę kotła CO do nastaw.

Przykładowa karta (analiza + zdjęcia):

```yaml
type: vertical-stack
cards:
  - type: markdown
    content: >
      ### Analiza AI
      {{ state_attr('sensor.wedzarnia_ostatni_cykl', 'ai_feedback') or 'Brak analizy' }}
  - type: picture-entity
    entity: image.wedzarnia_zdjecie_wyrobu
    show_state: false
  - type: button
    name: Wyślij zdjęcie z kamery do AI
    tap_action:
      action: call-service
      service: termometrwifi.upload_run_photo
      data: { which: product, camera_entity: camera.wedzarnia }
      target: { device_id: <device_id_wedzarni> }
```

## Pogoda z lokalnych czujników (HA → APP)

Zamiast pogody z API po lokalizacji, możesz wskazać własne czujniki HA — ich wartości trafią do
aplikacji/analizy. *Ustawienia → Urządzenia i usługi → TermometrWifi → Konfiguruj*:

- **Temperatura / Wilgotność / Wiatr** — encje `sensor.*` (wiatr w km/h).
- Integracja wysyła je co ~10 min do backendu (`POST /ha/weather`); przypina je jako obserwację do
  aktywnych cykli wędzenia. Worker **preferuje** te dane nad open-meteo, gdy są świeże (≤30 min);
  gdy przestaną przychodzić — wraca do API (o ile ustawiono lokalizację).

## Live powiadomienie wędzenia (telefon)

Blueprint [`blueprints/automation/termometrwifi/live_smoking_notification.yaml`](blueprints/automation/termometrwifi/live_smoking_notification.yaml)
tworzy powiadomienie aktualizujące się **w miejscu** (faza, komora, wsad, program) — jak żywy widok
w aplikacji. Wymaga aplikacji mobilnej Home Assistant.

1. *Ustawienia → Automatyzacje → Blueprinty → Importuj blueprint* (URL do pliku w repo) **lub** skopiuj
   plik do `config/blueprints/automation/termometrwifi/`.
2. Utwórz automatyzację z blueprintu: wskaż usługę powiadomień (`notify.mobile_app_…`) i encje
   (komora/wsad/etap/status/program).
3. Podczas wędzenia telefon pokazuje jedno, odświeżane powiadomienie; po STOP/KONIEC znika.

## Sterowanie — bezpieczeństwo

Komendy idą przez `POST /ha/command` (auth tym samym kluczem API) — backend publikuje na MQTT,
klient nie dostaje dostępu do brokera. Akcje destrukcyjne (reset WiFi/fabryczny, OTA) są zablokowane
po stronie serwera. Limit: 30 komend/min na klucz.

## Realtime (push) i odpytywanie

Integracja działa **w czasie rzeczywistym**: łączy się z brokerem przez MQTT-over-WebSocket i odbiera
zmiany od razu (zmiana w aplikacji / na sterowniku jest widoczna w HA i na karcie natychmiast).

- Dodatek **nie trzyma żadnych stałych danych MQTT**. Przy każdym połączeniu pobiera z
  `GET /ha/mqtt-credentials` (auth kluczem API) **krótkotrwały JWT** (subscribe-only, ACL tylko na
  Twoje SN-y) oraz adres brokera. Token jest rotowany przed wygaśnięciem (~1 h).
- Wyciek tokenu pozwala co najwyżej **czytać** telemetrię Twoich urządzeń przez < 1 h — nie pozwala
  sterować ani sięgnąć cudzych urządzeń. Sterowanie idzie osobno przez `POST /ha/command`.
- Gdy `paho-mqtt` lub broker są nieosiągalne, integracja po cichu działa dalej na samym **pollingu**.

Polling pozostaje jako **backstop**: domyślnie co **30 s** pobiera `GET /ha/state` + `GET /ha/alarms`
(API: limit 120 zapytań/min na klucz).

## Dokumentacja API

Pełny opis endpointów: [`docs/api.md`](https://github.com/termometrwifi-pl/termometrwifiapk/blob/main/docs/api.md)
w repozytorium głównym.

## Status

v0.3.0 — odczyt + **sterowanie wędzarnią** + **realtime push** (MQTT-WS z rotowanym JWT) + dedykowana
karta Lovelace. Wymaga backendu z endpointami `POST /ha/command` i `GET /ha/mqtt-credentials`.
