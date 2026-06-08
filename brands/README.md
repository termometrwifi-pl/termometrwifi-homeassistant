# Ikona integracji (Home Assistant brands)

HA pobiera ikonę integracji (lista *Urządzenia i usługi* + config flow) **wyłącznie** z repozytorium
[home-assistant/brands](https://github.com/home-assistant/brands) — serwowaną z
`https://brands.home-assistant.io/termometrwifi/icon.png`. Nie da się jej dołączyć lokalnie w
`custom_components/`. Dlatego, żeby zniknęło „no icon", trzeba **jednorazowo** wysłać PR do brands.

## Gotowe pliki

W [`custom_integrations/termometrwifi/`](custom_integrations/termometrwifi/) są już wygenerowane,
kwadratowe (przezroczyste) ikony zgodne z wymogami:

| Plik | Rozmiar |
|---|---|
| `icon.png` | 256×256 |
| `icon@2x.png` | 512×512 |
| `logo.png` | wys. 128 (szerokie dozwolone) |
| `logo@2x.png` | wys. 256 |

## Jak wysłać PR

1. Zforkuj `https://github.com/home-assistant/brands`.
2. Skopiuj folder `custom_integrations/termometrwifi/` (te pliki) do forka, w tę samą ścieżkę.
3. Commit + PR. Po zmerge'owaniu ikona pojawi się automatycznie w HA (CDN brands) — bez zmian w integracji.

> Domena musi się zgadzać z `manifest.json` → `"domain": "termometrwifi"`.
> Wygenerowane z `logoK4Bmale100.png` (wyśrodkowane, margines 8%). Jeśli chcesz inny kadr/margines,
> podmień źródło i przegeneruj.
