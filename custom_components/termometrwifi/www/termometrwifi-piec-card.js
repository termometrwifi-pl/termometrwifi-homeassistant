/*! TermometrWifi — karta kotła CO (piec) dla Home Assistant.
 *  type: custom:termometrwifi-piec-card
 *  Wygląd 1:1 jak w aplikacji: vendorowany widget (widget-piec.js) — schemat hydrauliczny,
 *  pasek statusu, komin, manometr, suwak nastawy, wykres, zasobnik paliwa, zużycie, ustawienia.
 *
 *  Dane (odczyt): surowe sensory pieca (encje per-topic) → ctx.sse shim, mapowane po sufiksie topiku
 *                 (unique_id encji = termometrwifi_{sn}_{suffix}, np. ...temp/piec → topic sn/temp/piec).
 *  Sterowanie (zapis): widget publikuje sn/cmd/<sub> → serwis termometrwifi.send_command
 *                      (POST /ha/command na sterownik). Bez build-stepu.
 *  Konfiguracja: { device_id, sn, accent_color, title, history_size }.
 */
(function () {
  "use strict";

  const DOMAIN = "termometrwifi";
  // Bump przy każdej zmianie karty/widgetu — fallback cache-bustingu (gdy brak ?v= z URL-a).
  const CARD_VERSION = "0.1.0";

  // Markery topiców pieca — po nich auto-wykrywamy sterownik kotła (gdy nie podano device_id/sn).
  const PIEC_MARKERS = ["temp/piec", "temp/co", "state", "fan/pct", "fuel/feeder"];

  // Widget i jego modale/overlay używają CSS-zmiennych --iot-* (część bez fallbacku). W HA nikt
  // ich nie definiuje → modale byłyby bez tła. Definiujemy globalnie (na :root — modale renderują
  // się w document.body, poza shadow DOM karty). Paleta = dark z aplikacji.
  function injectGlobalTheme() {
    if (document.getElementById("twifi-iot-theme")) return;
    const s = document.createElement("style");
    s.id = "twifi-iot-theme";
    s.textContent = `:root{
      --iot-bg:#0F1115; --iot-bg-2:#14171F; --iot-card:#1A1D24; --iot-card-2:#232730;
      --iot-border:#2A2F3A; --iot-text:#E6E9F0; --iot-text-dim:#8A92A6;
      --iot-accent:#6366F1; --iot-accent-2:#818CF8; --iot-success:#10B981;
      --iot-warn:#F59E0B; --iot-danger:#EF4444; --iot-flame:#F97316; --iot-water:#38BDF8;
    }`;
    document.head.appendChild(s);
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  class TermometrWifiPiecCard extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      this._map = null;          // suffix → entity_id (surowe sensory pieca)
      this._resolving = false;
      this._widget = null;
      this._subs = {};           // topic → [cb] (rejestr subskrypcji widgetu)
      this._last = {};           // topic → ostatnia wysłana wartość (dedup dispatchu)
      this.attachShadow({ mode: "open" });
    }

    getCardSize() { return 10; }

    set hass(hass) {
      this._hass = hass;
      if (!this._map) { if (!this._resolving) this._resolveEntities(); return; }
      this._dispatch();
    }

    _err(msg) {
      if (!this.shadowRoot) return;
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px;color:#EF4444;font-family:sans-serif;">${esc(msg)}</div></ha-card>`;
    }

    // ── Rozwiązywanie encji pieca (przez pełny rejestr — hass.entities nie ma unique_id) ──
    async _resolveEntities() {
      const hass = this._hass;
      if (!hass || !hass.devices) return;
      this._resolving = true;
      try {
        const ours = (d) => (d.identifiers || []).some((i) => Array.isArray(i) && i[0] === DOMAIN);
        const list = await hass.callWS({ type: "config/entity_registry/list" });

        // suffix z unique_id: "termometrwifi_{sn}_{suffix}" (sufiks może zawierać "/").
        const suffixOf = (uid, sn) => {
          const pfx = `${DOMAIN}_${sn}_`;
          if (sn && uid.startsWith(pfx)) return uid.slice(pfx.length);
          if (uid.startsWith(`${DOMAIN}_`)) {                // fallback: zdejmij domenę + 1 segment (sn)
            const r = uid.slice(DOMAIN.length + 1), i = r.indexOf("_");
            return i >= 0 ? r.slice(i + 1) : r;
          }
          return null;
        };
        // Mapa per-device: device_id → { sn, suffixes:{suffix:entity_id} }.
        const byDev = {};
        for (const e of list) {
          if (!e || e.platform !== DOMAIN || !e.device_id) continue;
          const dev = hass.devices[e.device_id];
          if (!dev || !ours(dev)) continue;
          const sn = (dev.identifiers.find((x) => x[0] === DOMAIN) || [])[1] || null;
          const suf = suffixOf(e.unique_id || "", sn);
          if (!suf) continue;
          (byDev[e.device_id] = byDev[e.device_id] || { sn, suffixes: {} }).suffixes[suf] = e.entity_id;
        }

        // Wybór sterownika: jawny device_id / sn, inaczej pierwszy z markerem pieca.
        let deviceId = this._config.device_id;
        if (deviceId && !byDev[deviceId]) deviceId = null;
        if (!deviceId && this._config.sn) {
          deviceId = Object.keys(byDev).find((id) => byDev[id].sn === this._config.sn) || null;
        }
        if (!deviceId) {
          deviceId = Object.keys(byDev).find((id) =>
            PIEC_MARKERS.some((m) => byDev[id].suffixes[m] != null)) || null;
        }
        if (!deviceId) { this._err("Nie znaleziono kotła (brak sterownika z topikami pieca)."); return; }

        const dev = hass.devices[deviceId];
        this._sn = byDev[deviceId].sn;
        this._deviceId = deviceId;
        this._deviceName = this._config.title || dev.name_by_user || dev.name || "Kocioł CO";
        this._map = byDev[deviceId].suffixes;
        await this._mountWidget();
      } catch (e) {
        this._err("Błąd odczytu rejestru encji pieca.");
      } finally {
        this._resolving = false;
      }
    }

    // ── Ładowanie vendorowanego widgetu (z cache-bustingiem zgodnym z kartą) ──
    _bustToken() {
      try {
        const el = document.querySelector(`script[src*="/${DOMAIN}/termometrwifi-piec-card.js"]`);
        if (el) {
          const v = new URL(el.src, location.origin).searchParams.get("v");
          if (v) return v;
        }
      } catch (e) {}
      return CARD_VERSION;
    }

    _loadWidget() {
      if (window.IoTWidgets && window.IoTWidgets.piec) return Promise.resolve();
      if (window.__twifiPiecLoading) return window.__twifiPiecLoading;
      window.__twifiPiecLoading = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = `/${DOMAIN}/widget-piec.js?v=${this._bustToken()}`;
        s.async = true;
        s.onload = () => res();
        s.onerror = () => rej(new Error("widget-piec load failed"));
        document.head.appendChild(s);
      });
      return window.__twifiPiecLoading;
    }

    async _mountWidget() {
      try {
        await this._loadWidget();
      } catch (e) {
        this._err("Nie udało się wczytać widgetu kotła. Sprawdź zasób /termometrwifi/widget-piec.js.");
        return;
      }
      const Widget = window.IoTWidgets && window.IoTWidgets.piec;
      if (!Widget) { this._err("Widget pieca niedostępny."); return; }
      injectGlobalTheme();
      this.shadowRoot.innerHTML = "";
      const host = document.createElement("div");
      this.shadowRoot.appendChild(host);
      this._widget = new Widget(this._cfg(), this._ctxShim());
      this._widget.mount(host);
      this._dispatch(true);   // pchnij bieżące stany od razu
    }

    _cfg() {
      // Sufiksy topiców zostawiamy domyślne (widget wypełnia je z DEF = topiki firmware piecv2).
      // Karta tylko mostkuje encje → topiki sn/<suffix>, więc nadpisywanie nie jest potrzebne.
      return {
        id: "ha_piec_" + (this._sn || "piec"),
        label: this._deviceName,
        accent_color: this._config.accent_color || "#F97316",
        history_size: this._config.history_size,
      };
    }

    _ctxShim() {
      const self = this;
      return {
        sn: this._sn,
        sse: {
          on(topic, cb) { (self._subs[topic] = self._subs[topic] || []).push(cb); },
          publish(topic, payload) { return self._publish(topic, payload); },
        },
      };
    }

    _stateObj(suffix) {
      const id = this._map && this._map[suffix];
      return id ? this._hass.states[id] : null;
    }

    // Czy sterownik online — z dowolnej encji pieca (unavailable/unknown = offline).
    _online() {
      for (const m of PIEC_MARKERS) {
        const s = this._stateObj(m);
        if (s) return !(s.state === "unavailable" || s.state === "unknown");
      }
      // brak markera — sprawdź jakąkolwiek encję
      for (const suf in this._map) {
        const s = this._stateObj(suf);
        if (s) return !(s.state === "unavailable" || s.state === "unknown");
      }
      return false;
    }

    // Pcha bieżące stany encji do widgetu jako "wiadomości MQTT" (sn/<suffix>).
    _dispatch(force) {
      if (!this._widget || !this._sn) return;
      const sn = this._sn;
      const fire = (topic, val) => {
        if (val == null) return;
        if (!force && this._last[topic] === val) return;
        this._last[topic] = val;
        (this._subs[topic] || []).forEach((cb) => { try { cb(val); } catch (e) {} });
      };
      fire(sn + "/status", this._online() ? "online" : "offline");
      for (const suffix in this._map) {
        const s = this._stateObj(suffix);
        if (!s) continue;
        const v = String(s.state);
        if (v === "unavailable" || v === "unknown") continue;
        fire(sn + "/" + suffix, v);
      }
    }

    // Publikacja z widgetu: sn/cmd/<sub> → serwis termometrwifi.send_command (suffix = cmd/<sub>).
    _publish(topic, payload) {
      const sn = this._sn;
      let suffix = topic;
      if (sn && topic.indexOf(sn + "/") === 0) suffix = topic.slice(sn.length + 1);
      try {
        return Promise.resolve(this._hass.callService(DOMAIN, "send_command", {
          device_id: this._deviceId,
          suffix,
          payload: String(payload),
        }));
      } catch (e) {
        return Promise.resolve();
      }
    }
  }

  if (!customElements.get("termometrwifi-piec-card"))
    customElements.define("termometrwifi-piec-card", TermometrWifiPiecCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "termometrwifi-piec-card",
    name: "TermometrWifi — Kocioł CO",
    description: "Karta kotła CO (piec) 1:1 z aplikacji: schemat hydrauliczny, nastawa, wykres, paliwo, zużycie. Opcje: device_id, sn, accent_color, title.",
    preview: false,
  });
  console.info("%c TERMOMETRWIFI-PIEC-CARD ", "background:#F97316;color:#fff;border-radius:3px");
})();
