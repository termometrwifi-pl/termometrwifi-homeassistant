/*! TermometrWifi — karta wędzarni dla Home Assistant Lovelace.
 *  type: custom:termometrwifi-smoker-card
 *  Auto-wykrywa urządzenie integracji i jego encje; sterowanie przez serwisy HA.
 *  Bez build-stepu (vanilla Web Component).
 */
(function () {
  "use strict";

  const DOMAIN = "termometrwifi";
  // Mapa kluczy (suffix unique_id po "termometrwifi_{sn}_") → logiczne pole karty.
  const KEYS = {
    chamber: "chamber", meat: "meat", phase: "phase", status: "status",
    recipe: "recipe", clock: "clock", elapsed: "elapsed", total: "total",
    heater: "heater", rssi: "rssi", ctrl: "ctrl", alarm: "alarm",
    num_target_chamber: "target_chamber", num_target_meat: "target_meat",
    num_dym: "dym", num_fan1: "fan1", num_fan2: "fan2",
    sel_program: "program", sw_light: "light",
    btn_start: "start", btn_stop: "stop",
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const numOf = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? null : n; };

  class TermometrWifiSmokerCard extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      this._map = null;       // key → entity_id
      this._sn = null;
      this._built = false;
      this.attachShadow({ mode: "open" });
    }

    getCardSize() { return 6; }

    set hass(hass) {
      this._hass = hass;
      if (!this._map) {
        if (!this._resolving) this._resolveEntities();  // async (WS), jednorazowo
        return;
      }
      if (!this._built) this._build();
      this._update();
    }

    /** Z rejestru urządzeń + pełnego rejestru encji (WS) wyznacza device, SN i mapę encji.
     *  hass.entities nie zawiera unique_id — dlatego pobieramy config/entity_registry/list. */
    async _resolveEntities() {
      const hass = this._hass;
      if (!hass || !hass.devices) return;
      this._resolving = true;
      try {
        let deviceId = this._config.device_id;
        const isOurDevice = (dev) =>
          (dev.identifiers || []).some((id) => Array.isArray(id) && id[0] === DOMAIN);

        if (!deviceId) {
          const wantSn = this._config.sn;
          for (const id in hass.devices) {
            const dev = hass.devices[id];
            if (!isOurDevice(dev)) continue;
            const sn = (dev.identifiers.find((x) => x[0] === DOMAIN) || [])[1];
            if (!wantSn || sn === wantSn) { deviceId = id; break; }
          }
        }
        if (!deviceId || !hass.devices[deviceId]) {
          this._renderError("Nie znaleziono urządzenia TermometrWifi (wędzarni).");
          return;
        }

        const dev = hass.devices[deviceId];
        this._deviceId = deviceId;
        this._sn = (dev.identifiers.find((x) => x[0] === DOMAIN) || [])[1] || null;
        this._deviceName = this._config.title || dev.name_by_user || dev.name || "Wędzarnia";

        const list = await hass.callWS({ type: "config/entity_registry/list" });
        const prefix = this._sn ? `${DOMAIN}_${this._sn}_` : null;
        const map = {};
        for (const ent of list) {
          if (!ent || ent.device_id !== deviceId || ent.platform !== DOMAIN) continue;
          const uid = ent.unique_id || "";
          let key = null;
          if (prefix && uid.startsWith(prefix)) key = uid.slice(prefix.length);
          else if (uid.startsWith(`${DOMAIN}_`)) {
            const rest = uid.slice(DOMAIN.length + 1);
            const idx = rest.indexOf("_");
            key = idx >= 0 ? rest.slice(idx + 1) : rest;
          }
          if (key && KEYS[key]) map[KEYS[key]] = ent.entity_id;
        }
        if (map.chamber || map.meat || map.program) {
          this._map = map;
          this._build();
          this._update();
        } else {
          this._renderError("Urządzenie nie ma encji wędzarni.");
        }
      } catch (e) {
        this._renderError("Błąd odczytu rejestru encji.");
      } finally {
        this._resolving = false;
      }
    }

    _st(key) {
      const id = this._map && this._map[key];
      if (!id || !this._hass.states[id]) return null;
      return this._hass.states[id].state;
    }
    _entId(key) { return this._map && this._map[key]; }

    _call(domain, service, data) { this._hass.callService(domain, service, data); }

    _renderError(msg) {
      if (!this.shadowRoot) return;
      this.shadowRoot.innerHTML =
        `<ha-card><div style="padding:16px;color:var(--error-color,#c00);">${esc(msg)}</div></ha-card>`;
    }

    _build() {
      const root = this.shadowRoot;
      root.innerHTML = `
        <style>
          ha-card { padding: 0; overflow: hidden; }
          .wrap { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
          .head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
          .name { font-weight:600; font-size:15px; }
          .badge { font-size:11px; font-weight:600; color:var(--primary-color); text-transform:uppercase; letter-spacing:.04em; }
          .clock { font-size:12px; color:var(--secondary-text-color); font-variant-numeric:tabular-nums; }
          .alarm { font-size:11px; font-weight:700; color:#fff; background:var(--error-color,#e53935); padding:2px 7px; border-radius:4px; }
          .tiles { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
          .tile { background:var(--secondary-background-color); border-radius:12px; padding:12px; cursor:pointer; position:relative; }
          .tile .lab { font-size:11px; color:var(--secondary-text-color); text-transform:uppercase; letter-spacing:.05em; }
          .tile .val { font-size:32px; font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; }
          .tile .val small { font-size:15px; font-weight:400; color:var(--secondary-text-color); }
          .tile .tgt { font-size:11px; color:var(--secondary-text-color); margin-top:4px; }
          .tile .pen { position:absolute; top:8px; right:10px; font-size:11px; color:var(--primary-color); }
          .row { display:flex; gap:8px; align-items:center; }
          .chips { display:grid; grid-template-columns:repeat(auto-fit,minmax(90px,1fr)); gap:8px; }
          .chip { background:var(--secondary-background-color); border-radius:8px; padding:7px; text-align:center; }
          .chip .l { font-size:10px; color:var(--secondary-text-color); text-transform:uppercase; }
          .chip .v { font-size:14px; font-weight:700; }
          select, button, input[type=range] { font-family:inherit; }
          select { flex:1; padding:8px; border-radius:8px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); }
          .btn { padding:9px 14px; border-radius:8px; border:none; font-weight:700; cursor:pointer; letter-spacing:.04em; }
          .btn.start { background:var(--success-color,#43a047); color:#fff; }
          .btn.stop { background:var(--error-color,#e53935); color:#fff; }
          .outs { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; }
          .out { background:var(--secondary-background-color); border-radius:10px; padding:10px; }
          .out .l { font-size:10px; color:var(--secondary-text-color); text-transform:uppercase; margin-bottom:6px; display:flex; justify-content:space-between; }
          .out input[type=range] { width:100%; }
          .toggle { width:100%; padding:8px; border-radius:8px; border:1px solid var(--divider-color); cursor:pointer; font-weight:700; }
          .toggle.on { background:var(--primary-color); color:#fff; border-color:var(--primary-color); }
          .bar { height:6px; background:var(--divider-color); border-radius:99px; overflow:hidden; }
          .bar > div { height:100%; background:var(--primary-color); transition:width .5s; }
        </style>
        <ha-card>
          <div class="wrap">
            <div class="head">
              <div class="row" style="min-width:0;">
                <span class="name" data-f="name"></span>
                <span class="badge" data-f="badge"></span>
              </div>
              <div class="row">
                <span class="alarm" data-f="alarm" style="display:none;">ALARM</span>
                <span class="clock" data-f="clock"></span>
              </div>
            </div>
            <div class="tiles">
              <div class="tile" data-edit="chamber">
                <span class="pen">✎ ZMIEŃ</span>
                <div class="lab" data-f="chamber-lab">Komora</div>
                <div class="val"><span data-f="chamber">—</span><small>°C</small></div>
                <div class="tgt" data-f="chamber-tgt"></div>
              </div>
              <div class="tile" data-edit="meat">
                <span class="pen">✎ ZMIEŃ</span>
                <div class="lab">Wsad</div>
                <div class="val"><span data-f="meat">—</span><small>°C</small></div>
                <div class="tgt" data-f="meat-tgt"></div>
              </div>
            </div>
            <div class="row">
              <div class="bar" style="flex:1;"><div data-f="progress" style="width:0%"></div></div>
              <span class="clock" data-f="time">— / —</span>
            </div>
            <div class="row">
              <select data-f="program"></select>
              <button class="btn start" data-act="start">▶ START</button>
              <button class="btn stop" data-act="stop">■ STOP</button>
            </div>
            <div class="chips">
              <div class="chip"><div class="l">Status</div><div class="v" data-f="status">—</div></div>
              <div class="chip"><div class="l">Etap</div><div class="v" data-f="phase">—</div></div>
              <div class="chip"><div class="l">Grzałka</div><div class="v" data-f="heater">—</div></div>
              <div class="chip"><div class="l">WiFi</div><div class="v" data-f="rssi">—</div></div>
            </div>
            <div class="outs" data-f="outs"></div>
          </div>
        </ha-card>`;

      this._f = {};
      root.querySelectorAll("[data-f]").forEach((el) => (this._f[el.getAttribute("data-f")] = el));

      // Program
      const sel = this._f.program;
      ["MANUAL", "SZYNKA", "KIELBASA", "KRAKOWSKA", "RYBA", "WLASNY", "PRZEPIS"].forEach((p) => {
        const o = document.createElement("option"); o.value = p; o.textContent = p; sel.appendChild(o);
      });
      sel.addEventListener("change", () => {
        const id = this._entId("program");
        if (id) this._call("select", "select_option", { entity_id: id, option: sel.value });
      });

      // Start/Stop
      root.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", () => {
        const id = this._entId(btn.getAttribute("data-act"));
        if (id) this._call("button", "press", { entity_id: id });
      }));

      // Edycja celów (klik w kafelek → number.set_value przez prompt)
      root.querySelectorAll("[data-edit]").forEach((t) => t.addEventListener("click", () => {
        const which = t.getAttribute("data-edit") === "chamber" ? "target_chamber" : "target_meat";
        const id = this._entId(which);
        if (!id) return;
        const cur = this._hass.states[id] ? this._hass.states[id].state : "";
        const v = window.prompt("Ustaw cel (°C):", cur);
        if (v == null) return;
        const n = numOf(v);
        if (n != null) this._call("number", "set_value", { entity_id: id, value: n });
      }));

      // Wyjścia: DYM / FAN1 / FAN2 (slidery) + Światło (toggle)
      const outs = this._f.outs;
      [["dym", "Generator dymu"], ["fan1", "Wentylator 1"], ["fan2", "Wentylator 2"]].forEach(([k, lab]) => {
        if (!this._entId(k)) return;
        const cell = document.createElement("div");
        cell.className = "out";
        cell.innerHTML = `<div class="l"><span>${esc(lab)}</span><span data-pct="${k}">0%</span></div>
          <input type="range" min="0" max="100" step="1" data-pwr="${k}">`;
        outs.appendChild(cell);
        const rng = cell.querySelector("input");
        rng.addEventListener("change", () => {
          const id = this._entId(k);
          if (id) this._call("number", "set_value", { entity_id: id, value: parseInt(rng.value, 10) });
        });
      });
      if (this._entId("light")) {
        const cell = document.createElement("div");
        cell.className = "out";
        cell.innerHTML = `<div class="l"><span>Światło</span></div>
          <button class="toggle" data-light>OFF</button>`;
        outs.appendChild(cell);
        cell.querySelector("[data-light]").addEventListener("click", () => {
          const id = this._entId("light");
          if (!id) return;
          const on = this._hass.states[id] && this._hass.states[id].state === "on";
          this._call("switch", on ? "turn_off" : "turn_on", { entity_id: id });
        });
      }

      this._built = true;
    }

    _update() {
      const f = this._f;
      f.name.textContent = this._deviceName || "Wędzarnia";

      const prog = this._st("program");
      const recipe = this._st("recipe");
      const badge = /^przepis$/i.test(prog || "") && recipe ? `PRZEPIS · ${recipe}` : (prog || "");
      f.badge.textContent = badge || "";

      f.clock.textContent = this._st("clock") || "";

      const setTemp = (key, tgtKey, tgtField, valField) => {
        const v = numOf(this._st(key));
        f[valField].textContent = v == null ? "—" : Math.round(v);
        const t = numOf(this._st(tgtKey));
        f[tgtField].textContent = t != null && t > 0 ? `cel ${Math.round(t)}°C` : "ustaw cel";
      };
      setTemp("chamber", "target_chamber", "chamber-tgt", "chamber");
      setTemp("meat", "target_meat", "meat-tgt", "meat");

      // Postęp (elapsed / total w sekundach)
      const el = numOf(this._st("elapsed")), tot = numOf(this._st("total"));
      const fmt = (s) => { if (s == null) return "—"; const m = Math.floor(s / 60); const h = Math.floor(m / 60); return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`; };
      f.time.textContent = `${fmt(el)} / ${fmt(tot)}`;
      f.progress.style.width = (tot && el != null && tot > 0 ? Math.min(100, (el / tot) * 100) : 0) + "%";

      // Program select (bez nadpisywania gdy user właśnie wybiera)
      if (prog && document.activeElement !== f.program) {
        const up = String(prog).toUpperCase();
        if ([...f.program.options].some((o) => o.value === up)) f.program.value = up;
      }

      f.status.textContent = this._st("status") || "—";
      f.phase.textContent = this._st("phase") || "—";
      const heater = numOf(this._st("heater"));
      f.heater.textContent = heater == null ? "—" : `${Math.round(heater)}%`;
      const rssi = numOf(this._st("rssi"));
      f.rssi.textContent = rssi == null ? "—" : `${Math.round(rssi)} dBm`;

      // Alarm
      const al = this._st("alarm");
      f.alarm.style.display = al === "on" ? "inline-block" : "none";

      // Wyjścia
      ["dym", "fan1", "fan2"].forEach((k) => {
        const id = this._entId(k); if (!id) return;
        const v = numOf(this._st(k)) || 0;
        const rng = this.shadowRoot.querySelector(`input[data-pwr="${k}"]`);
        const pct = this.shadowRoot.querySelector(`[data-pct="${k}"]`);
        if (rng && document.activeElement !== rng) rng.value = Math.round(v);
        if (pct) pct.textContent = `${Math.round(v)}%`;
      });
      const lid = this._entId("light");
      if (lid) {
        const btn = this.shadowRoot.querySelector("[data-light]");
        const on = this._hass.states[lid] && this._hass.states[lid].state === "on";
        if (btn) { btn.textContent = on ? "ON" : "OFF"; btn.classList.toggle("on", !!on); }
      }
    }
  }

  if (!customElements.get("termometrwifi-smoker-card")) {
    customElements.define("termometrwifi-smoker-card", TermometrWifiSmokerCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "termometrwifi-smoker-card",
    name: "TermometrWifi — Wędzarnia",
    description: "Karta sterowania wędzarnią (komora/wsad, program, START/STOP, dym, wentylatory, światło).",
    preview: false,
  });
  console.info("%c TERMOMETRWIFI-SMOKER-CARD ", "background:#43a047;color:#fff;border-radius:3px");
})();
