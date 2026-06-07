/*! TermometrWifi — karta wędzarni dla Home Assistant.
 *  type: custom:termometrwifi-smoker-card
 *  Dwa style (config `style`):
 *    - "modern"  (domyślny): vendorowany widget z aplikacji (widget-smoker.js) — wygląd 1:1,
 *                 z wykresem fullscreen, pan/zoom, modalami. Dane z encji → ctx.sse shim.
 *    - "classic": lekka karta renderowana tutaj, w duchu HA.
 *  Sterowanie zawsze przez serwisy HA (number/select/switch/button). Bez build-stepu.
 *  Konfiguracja: { style, device_id, sn, chamber_label, meat_label, unit, accent_color, title }.
 */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const DOMAIN = "termometrwifi";

  // Paleta identyczna z aplikacją (dark) — karta wygląda tak samo niezależnie od motywu HA.
  const T = {
    bg0: "#0F1115", bg1: "#14171F", bg2: "#1A1D24", bg3: "#232730", border: "#2A2F3A",
    text0: "#E6E9F0", text1: "#5C6478", indigo: "#6366F1", indigoL: "#818CF8",
    green: "#10B981", amber: "#F59E0B", red: "#EF4444",
  };

  // 0=Manual(ukryte), 1=Ociekanie, 2=Rozgrzewanie, 3=Osuszanie, 4=Rozpalanie,
  // 5=Wędzenie, 6=ukryte, 7=Pieczenie, 8=Koniec.
  const DEFAULT_PHASES = [
    { label: "Manual", color: "#8A92A6", hidden: true },
    { label: "Ociekanie", color: "#6366F1" },
    { label: "Rozgrzewanie", color: "#F59E0B" },
    { label: "Osuszanie", color: "#F59E0B" },
    { label: "Rozpalanie", color: "#EF4444" },
    { label: "Wędzenie", color: "#10B981" },
    { label: "—", color: "#2A2F3A", hidden: true },
    { label: "Pieczenie", color: "#818CF8" },
    { label: "Koniec", color: "#10B981" },
  ];

  const PROGRAM_OPTIONS = ["MANUAL", "SZYNKA", "KIELBASA", "KRAKOWSKA", "RYBA", "WLASNY", "PRZEPIS"];

  // Parametry programu WLASNY → klucz encji number (w_*) + opis.
  const PROG_PARAMS = [
    { ent: "w_dripping", label: "Ociekanie", unit: "min", step: 1 },
    { ent: "w_drying", label: "Osuszanie", unit: "min", step: 1 },
    { ent: "w_smoking", label: "Wędzenie", unit: "min", step: 1 },
    { ent: "w_baking", label: "Pieczenie", unit: "min", step: 1 },
    { ent: "w_heat", label: "Temp. rozgrzewania", unit: "°C", step: 0.1 },
    { ent: "w_dry", label: "Temp. suszenia", unit: "°C", step: 0.1 },
    { ent: "w_smoke", label: "Temp. wędzenia", unit: "°C", step: 0.1 },
    { ent: "w_bake", label: "Temp. pieczenia", unit: "°C", step: 0.1 },
    { ent: "w_meat_max", label: "Temp. wsadu max", unit: "°C", step: 0.1 },
  ];

  // Klucz unique_id (po "termometrwifi_{sn}_") → logiczne pole.
  const KEYS = {
    chamber: "chamber", meat: "meat", phase: "phase", status: "status", recipe: "recipe",
    clock: "clock", elapsed: "elapsed", total: "total", heater: "heater", rssi: "rssi",
    ctrl: "ctrl", alarm: "alarm",
    num_target_chamber: "target_chamber", num_target_meat: "target_meat",
    num_dym: "dym", num_fan1: "fan1", num_fan2: "fan2",
    num_w_dripping: "w_dripping", num_w_drying: "w_drying", num_w_smoking: "w_smoking",
    num_w_baking: "w_baking", num_w_heat: "w_heat", num_w_dry: "w_dry",
    num_w_smoke: "w_smoke", num_w_bake: "w_bake", num_w_meat_max: "w_meat_max",
    sel_program: "program", sw_light: "light", btn_start: "start", btn_stop: "stop",
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (p, fb) => { const v = parseFloat(String(p).replace(",", ".")); return isNaN(v) ? fb : v; };
  const formatTime = (mins) => {
    if (mins == null || isNaN(mins)) return "—";
    const h = Math.floor(mins / 60), m = Math.floor(mins % 60);
    return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  };

  function injectModalCss() {
    if (document.getElementById("twifi-sm-css")) return;
    const s = document.createElement("style");
    s.id = "twifi-sm-css";
    s.textContent = `
      .twifi-sm-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.65); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; }
      .twifi-sm-panel { width:100%; max-width:480px; max-height:90vh; overflow:auto; background:${T.bg1}; border:1px solid ${T.border}; border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px; box-shadow:0 20px 60px rgba(0,0,0,.45); color:${T.text0}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
      .twifi-sm-head { display:flex; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid ${T.border}; }
      .twifi-sm-title { font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
      .twifi-sm-row { display:grid; grid-template-columns:1fr 130px; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid ${T.border}; }
      .twifi-sm-row:last-child { border-bottom:none; }
      .twifi-sm-row label { font-size:12px; }
      .twifi-sm-row .unit { font-size:10px; color:${T.text1}; margin-left:4px; }
      .twifi-sm-row .live { font-size:10px; color:${T.text1}; }
      .twifi-sm-row input { width:100%; padding:6px 8px; background:${T.bg0}; color:${T.text0}; border:1px solid ${T.border}; border-radius:6px; font-size:13px; box-sizing:border-box; font-variant-numeric:tabular-nums; }
      .twifi-sm-row input:focus { outline:none; border-color:${T.indigo}; }
      .twifi-sm-foot { display:flex; gap:8px; padding-top:10px; border-top:1px solid ${T.border}; }
      .twifi-sm-foot button { flex:1; padding:9px; border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
      .twifi-sm-foot .save { background:${T.green}; color:#fff; }
      .twifi-sm-foot .cancel { background:${T.bg3}; color:${T.text0}; }
    `;
    document.head.appendChild(s);
  }

  class TermometrWifiSmokerCard extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      // Styl karty: "modern" (vendorowany widget z aplikacji, 1:1) lub "classic" (lekki, w stylu HA).
      this._style = String(this._config.style || "modern").toLowerCase();
      if (this._style === "ha" || this._style === "app") this._style = this._style === "app" ? "modern" : "classic";
      this._chamberLabel = this._config.chamber_label || "DYM";
      this._meatLabel = this._config.meat_label || "WSAD";
      this._map = null;
      this._built = false;
      this._resolving = false;
      this.history = [];
      this.MEM_CAP = 600;
      this._runLocked = true;
      this._last = {};
      this.state = {
        chamberTemp: null, meatTemp: null, targetChamber: 0, targetMeat: 0,
        elapsedMinutes: 0, totalMinutes: 0, currentPhase: 0,
        heaterOn: false, fan1On: false, fan2On: false, dymOn: false, lightOn: false,
        fan1Pct: 0, fan2Pct: 0, dymPct: 0, ctrlMode: "ONOFF",
        wifiRssi: null, programName: "", recipeName: "", statName: "", czasString: "",
        online: true, programParams: {}, phases: DEFAULT_PHASES,
      };
      injectModalCss();
      this.attachShadow({ mode: "open" });
    }

    getCardSize() { return 8; }

    set hass(hass) {
      this._hass = hass;
      if (!this._map) { if (!this._resolving) this._resolveEntities(); return; }
      if (this._style === "modern") { this._dispatchModern(); return; }
      this._syncState();
      if (!this._built) this._build();
      this._renderAll();
    }

    // ── Rozwiązywanie encji (przez pełny rejestr — hass.entities nie ma unique_id) ──
    async _resolveEntities() {
      const hass = this._hass;
      if (!hass || !hass.devices) return;
      this._resolving = true;
      try {
        let deviceId = this._config.device_id;
        const ours = (d) => (d.identifiers || []).some((i) => Array.isArray(i) && i[0] === DOMAIN);
        if (!deviceId) {
          const wantSn = this._config.sn;
          for (const id in hass.devices) {
            const d = hass.devices[id];
            if (!ours(d)) continue;
            const sn = (d.identifiers.find((x) => x[0] === DOMAIN) || [])[1];
            if (!wantSn || sn === wantSn) { deviceId = id; break; }
          }
        }
        if (!deviceId || !hass.devices[deviceId]) { this._err("Nie znaleziono wędzarni."); return; }
        const dev = hass.devices[deviceId];
        this._sn = (dev.identifiers.find((x) => x[0] === DOMAIN) || [])[1] || null;
        this._deviceName = this._config.title || dev.name_by_user || dev.name || "Wędzarnia";
        const list = await hass.callWS({ type: "config/entity_registry/list" });
        const prefix = this._sn ? `${DOMAIN}_${this._sn}_` : null;
        const map = {};
        for (const e of list) {
          if (!e || e.device_id !== deviceId || e.platform !== DOMAIN) continue;
          const uid = e.unique_id || "";
          let key = null;
          if (prefix && uid.startsWith(prefix)) key = uid.slice(prefix.length);
          else if (uid.startsWith(`${DOMAIN}_`)) {
            const r = uid.slice(DOMAIN.length + 1), i = r.indexOf("_");
            key = i >= 0 ? r.slice(i + 1) : r;
          }
          if (key && KEYS[key]) map[KEYS[key]] = e.entity_id;
        }
        if (map.chamber || map.meat || map.program) {
          this._map = map;
          if (this._style === "modern") this._mountModern();
          else { this._syncState(); this._build(); this._renderAll(); }
        } else this._err("Urządzenie nie ma encji wędzarni.");
      } catch (e) { this._err("Błąd odczytu rejestru encji."); }
      finally { this._resolving = false; }
    }

    _id(key) { return this._map && this._map[key]; }
    _stateObj(key) { const id = this._id(key); return id ? this._hass.states[id] : null; }
    _num(key) { const s = this._stateObj(key); return s ? num(s.state, null) : null; }
    _str(key) { const s = this._stateObj(key); return s ? String(s.state) : ""; }

    _err(msg) {
      if (!this.shadowRoot) return;
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px;color:#EF4444;">${esc(msg)}</div></ha-card>`;
    }

    // Encje → this.state (jak subskrypcje MQTT w widgetcie).
    _syncState() {
      const st = this.state, S = this._stateObj.bind(this);
      const chamberS = S("chamber"), meatS = S("meat");
      const bad = (s) => !s || s.state === "unavailable" || s.state === "unknown";
      st.online = !(bad(chamberS) && bad(meatS));

      st.chamberTemp = this._num("chamber");
      st.meatTemp = this._num("meat");
      st.targetChamber = this._num("target_chamber") || 0;
      st.targetMeat = this._num("target_meat") || 0;
      const el = this._num("elapsed"); st.elapsedMinutes = el != null ? el / 60 : 0;
      const tot = this._num("total"); st.totalMinutes = tot != null ? tot / 60 : 0;

      // Etap: surowy indeks z atrybutu sensora.
      const phS = S("phase");
      let ph = phS && phS.attributes && phS.attributes.index;
      if (ph == null) { const n = num(phS ? phS.state : null, null); ph = n == null ? 0 : n; }
      st.currentPhase = ph | 0;

      const heater = this._num("heater"); st.heaterOn = heater != null && heater > 0;
      st.dymPct = Math.max(0, Math.min(100, (this._num("dym") || 0) | 0)); st.dymOn = st.dymPct > 0;
      st.fan1Pct = Math.max(0, Math.min(100, (this._num("fan1") || 0) | 0)); st.fan1On = st.fan1Pct > 0;
      st.fan2Pct = Math.max(0, Math.min(100, (this._num("fan2") || 0) | 0)); st.fan2On = st.fan2Pct > 0;
      const lightS = S("light"); st.lightOn = !!lightS && lightS.state === "on";
      st.ctrlMode = /triac/i.test(this._str("ctrl")) ? "TRIAC" : "ONOFF";
      st.programName = (this._str("program") || "").trim();
      st.recipeName = (this._str("recipe") || "").trim();
      st.statName = (this._str("status") || "").trim().toUpperCase();
      st.czasString = (this._str("clock") || "").trim();
      st.wifiRssi = this._num("rssi");
      st.programParams = {};
      PROG_PARAMS.forEach((p) => { st.programParams[p.ent] = this._num(p.ent); });

      // Historia do wykresu (próbka gdy zmienia się temperatura).
      if (st.online && (st.chamberTemp != null || st.meatTemp != null)) {
        const last = this.history[this.history.length - 1];
        if (!last || last.chamber !== st.chamberTemp || last.meat !== st.meatTemp) {
          this.history.push({ t: Date.now(), chamber: st.chamberTemp, meat: st.meatTemp });
          while (this.history.length > this.MEM_CAP) this.history.shift();
        }
      }
    }

    // ── Akcje (serwisy HA) ──
    _setNumber(key, value) { const id = this._id(key); if (id) this._hass.callService("number", "set_value", { entity_id: id, value }); }
    _selectProgram(name) { const id = this._id("program"); if (id) this._hass.callService("select", "select_option", { entity_id: id, option: name }); }
    _press(key) { const id = this._id(key); if (id) this._hass.callService("button", "press", { entity_id: id }); }
    _setLight(on) { const id = this._id("light"); if (id) this._hass.callService("switch", on ? "turn_on" : "turn_off", { entity_id: id }); }

    _build() {
      const accent = T.green;
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; }
          ha-card { background:${T.bg1}; border-top:3px solid ${accent}; border-radius:14px; overflow:hidden; color:${T.text0}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
          input[type=range] { accent-color:${accent}; }
          button { font-family:inherit; }
        </style>
        <ha-card>
          <div class="sm-head" style="padding:10px 14px;background:${T.bg0};display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
              <span data-slot="offline" style="display:none;font-size:10px;font-weight:700;color:${T.red};background:${T.red}22;padding:2px 6px;border-radius:3px;letter-spacing:.08em;text-transform:uppercase;">OFFLINE</span>
              <span style="font-size:11px;font-weight:600;color:${T.text0};text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(this._deviceName || "Wędzarnia")}</span>
              <span data-slot="program" style="font-size:10px;font-weight:600;color:${accent};text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" hidden></span>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <span data-slot="wifi" style="display:inline-flex;align-items:center;height:14px;"></span>
              <span data-slot="elapsed" style="font-size:10px;color:${accent};font-weight:600;font-variant-numeric:tabular-nums;">—</span>
            </div>
          </div>
          <div style="padding:14px;">
            <div data-slot="tiles" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;"></div>
            <div style="background:${T.bg0};border-radius:10px;padding:10px 12px;margin-bottom:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;">Przebieg temperatury</span>
                <div style="display:flex;gap:10px;">
                  <div style="display:flex;align-items:center;gap:4px;"><svg width="12" height="3"><line x1="0" y1="1.5" x2="12" y2="1.5" stroke="${accent}" stroke-width="2"/></svg><span style="font-size:9px;color:${T.text1};">${esc(this._chamberLabel)}</span></div>
                  <div style="display:flex;align-items:center;gap:4px;"><svg width="12" height="3"><line x1="0" y1="1.5" x2="12" y2="1.5" stroke="${T.amber}" stroke-width="2" stroke-dasharray="4,3"/></svg><span style="font-size:9px;color:${T.text1};">${esc(this._meatLabel)}</span></div>
                </div>
              </div>
              <div data-slot="chart" style="height:clamp(70px,16vh,200px);"></div>
            </div>
            <div style="background:${T.bg2};border-radius:10px;padding:10px 12px;margin-bottom:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;">
                <div style="display:flex;align-items:center;gap:6px;min-width:0;">
                  <span style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;">Program</span>
                  <button type="button" data-slot="prog-edit" title="Edytuj program własny" style="border:1px solid ${T.border};background:${T.bg0};color:${T.text0};border-radius:4px;width:20px;height:20px;font-size:11px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;">⚙</button>
                </div>
                <span data-slot="program-name" style="font-size:10px;color:${T.text0};font-weight:600;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%;"></span>
              </div>
              <div data-slot="phases" style="display:flex;gap:4px;margin-bottom:10px;"></div>
              <div data-slot="run" style="margin-bottom:10px;"></div>
              <div style="display:flex;align-items:center;gap:8px;">
                <div style="flex:1;height:6px;background:${T.bg3};border-radius:999px;overflow:hidden;"><div data-slot="progress" style="height:100%;width:0%;background:linear-gradient(90deg,${T.indigo},${accent});border-radius:999px;transition:width .6s ease;"></div></div>
                <span data-slot="time" style="font-size:11px;color:${T.text0};font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;">— / —</span>
              </div>
            </div>
            <div data-slot="chips" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;"></div>
            <div data-slot="controls" style="margin-top:10px;"></div>
          </div>
        </ha-card>`;
      const q = (s) => this.shadowRoot.querySelector(`[data-slot="${s}"]`);
      this._slot = {
        offline: q("offline"), program: q("program"), wifi: q("wifi"), elapsed: q("elapsed"),
        progEdit: q("prog-edit"), programName: q("program-name"), tiles: q("tiles"),
        chart: q("chart"), phases: q("phases"), run: q("run"), progress: q("progress"),
        time: q("time"), chips: q("chips"), controls: q("controls"),
      };
      this._slot.progEdit.addEventListener("click", () => this._openProgramEditor());
      this._slot.tiles.addEventListener("click", (e) => {
        const tile = e.target.closest("[data-edit]"); if (!tile) return;
        const which = tile.getAttribute("data-edit");
        const isC = which === "chamber";
        this._openValueEdit({
          title: isC ? "Cel KOMORA" : "Cel SONDA",
          value: (isC ? this.state.targetChamber : this.state.targetMeat) || "",
          unit: "°C", step: 0.5, min: 0, max: 300,
          onSave: (v) => this._setNumber(isC ? "target_chamber" : "target_meat", v),
        });
      });
      this._built = true;
    }

    _renderAll() {
      this._renderHeader(); this._renderWifi(); this._renderTiles(); this._renderChart();
      this._renderPhases(); this._renderProgress(); this._renderChips(); this._renderControls();
    }

    _renderWifi() {
      const accent = T.green, r = this.state.wifiRssi;
      const off = !this.state.online || r == null;
      if (off) {
        this._slot.wifi.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M2 2L22 22" stroke="${T.text1}" stroke-width="2" stroke-linecap="round"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0" stroke="${T.text1}" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="20" x2="12.01" y2="20" stroke="${T.text1}" stroke-width="2" stroke-linecap="round"/></svg>`;
        return;
      }
      let level = 1; if (r >= -60) level = 3; else if (r >= -75) level = 2;
      this._slot.wifi.title = `WiFi ${r} dBm`;
      this._slot.wifi.innerHTML = [4, 7, 10].map((h, i) =>
        `<span style="display:inline-block;width:3px;height:${h}px;background:${(i + 1) <= level ? accent : T.bg3};border-radius:1px;vertical-align:bottom;margin-right:1px;"></span>`).join("");
    }

    _renderHeader() {
      const st = this.state;
      this._slot.offline.style.display = st.online ? "none" : "inline-block";
      if (!st.online) { this._slot.elapsed.textContent = ""; this._slot.program.hidden = true; this._slot.programName.textContent = ""; return; }
      this._slot.elapsed.textContent = st.czasString || formatTime(st.elapsedMinutes);
      const isCustom = /^przepis$/i.test(st.programName);
      const name = isCustom ? (st.recipeName ? `PRZEPIS - ${st.recipeName}` : "PRZEPIS") : st.programName;
      if (name) { this._slot.program.textContent = "· " + name; this._slot.program.hidden = false; this._slot.programName.textContent = name; }
      else { this._slot.program.hidden = true; this._slot.programName.textContent = ""; }
    }

    _renderTiles() {
      const accent = T.green, off = !this.state.online;
      const tiles = [
        { edit: "chamber", label: this._chamberLabel, value: off ? null : this.state.chamberTemp, target: off ? 0 : this.state.targetChamber, color: accent,
          ok: !off && this.state.chamberTemp != null && Math.abs(this.state.chamberTemp - this.state.targetChamber) < 8 },
        { edit: "meat", label: this._meatLabel, value: off ? null : this.state.meatTemp, target: off ? 0 : this.state.targetMeat, color: T.amber,
          ok: !off && this.state.meatTemp != null && this.state.meatTemp >= this.state.targetMeat * 0.9 },
      ];
      const canEdit = !off;
      this._slot.tiles.innerHTML = tiles.map(({ edit, label, value, target, color, ok }) => {
        const display = value == null ? "—" : Math.round(value);
        const fillH = value == null ? 0 : Math.min((value / 200) * 100, 100);
        const editAttr = canEdit ? ` data-edit="${edit}" role="button" tabindex="0"` : "";
        return `<div${editAttr} style="background:${T.bg2};border:1px solid ${canEdit ? color + "55" : (ok ? color + "44" : T.border)};border-radius:10px;padding:10px 12px;position:relative;overflow:hidden;${canEdit ? "cursor:pointer;" : ""}">
          <div style="position:absolute;bottom:0;left:0;right:0;height:${fillH}%;background:${color}10;transition:height .6s ease;"></div>
          ${canEdit ? `<span style="position:absolute;top:7px;right:7px;display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:999px;background:${color}22;border:1px solid ${color}66;color:${color};font-size:9px;font-weight:700;line-height:1;z-index:1;">✎ ZMIEŃ</span>` : ""}
          <div style="position:relative;">
            <div style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">${esc(label)}</div>
            <div style="font-size:36px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;line-height:1;">${display}<span style="font-size:16px;color:${T.text1};font-weight:400;">°C</span></div>
            <div style="margin-top:6px;display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:10px;color:${T.text1};">${target > 0 ? "/" + Math.round(target) + "°C" : (canEdit ? "ustaw cel" : "—")}</span>
              <span style="font-size:9px;font-weight:600;color:${color};text-transform:uppercase;">${ok ? "✓ OK" : "..."}</span>
            </div>
          </div>
        </div>`;
      }).join("");
    }

    _renderChart() {
      const W = 320, H = 80, MIN = 0, MAX = 160, accent = T.green;
      const toY = (v) => H - ((v - MIN) / (MAX - MIN)) * H;
      const slot = this._slot.chart;
      const old = slot.querySelector("svg"); if (old) old.remove();
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("preserveAspectRatio", "none");
      svg.style.cssText = "display:block;width:100%;height:100%;overflow:visible;";
      const uid = "g" + Math.random().toString(36).slice(2, 7);
      svg.innerHTML = `<defs>
        <linearGradient id="${uid}-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${accent}" stop-opacity="0.22"/><stop offset="100%" stop-color="${accent}" stop-opacity="0.02"/></linearGradient>
        <linearGradient id="${uid}-m" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${T.amber}" stop-opacity="0.16"/><stop offset="100%" stop-color="${T.amber}" stop-opacity="0.01"/></linearGradient>
        <clipPath id="${uid}-clip"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>`;
      [40, 80, 120, 160].forEach((v) => { const l = document.createElementNS(SVG_NS, "line"); l.setAttribute("x1", 0); l.setAttribute("x2", W); l.setAttribute("y1", toY(v)); l.setAttribute("y2", toY(v)); l.setAttribute("stroke", T.border); svg.appendChild(l); });
      const dash = (y, c, o) => { const l = document.createElementNS(SVG_NS, "line"); l.setAttribute("x1", 0); l.setAttribute("x2", W); l.setAttribute("y1", y); l.setAttribute("y2", y); l.setAttribute("stroke", c); l.setAttribute("stroke-dasharray", "4,3"); l.setAttribute("opacity", o); svg.appendChild(l); };
      dash(toY(this.state.targetChamber), accent, "0.6"); dash(toY(this.state.targetMeat), T.amber, "0.5");
      const hist = this.history.slice(-60);
      if (hist.length >= 2) {
        const pts = (k) => hist.map((d, i) => [i * (W / (hist.length - 1)), toY(d[k] != null ? d[k] : MIN)]);
        const smooth = (p) => { if (p.length < 2) return ""; let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`; for (let i = 1; i < p.length; i++) { const [px, py] = p[i - 1], [cx, cy] = p[i], mx = (px + cx) / 2; d += ` C${mx.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`; } return d; };
        const cPts = pts("chamber"), mPts = pts("meat"), cPath = smooth(cPts), mPath = smooth(mPts);
        const g = document.createElementNS(SVG_NS, "g"); g.setAttribute("clip-path", `url(#${uid}-clip)`);
        const area = (path, fill) => { const a = document.createElementNS(SVG_NS, "path"); a.setAttribute("d", `${path} L${W},${H} L0,${H} Z`); a.setAttribute("fill", fill); return a; };
        g.appendChild(area(cPath, `url(#${uid}-c)`)); g.appendChild(area(mPath, `url(#${uid}-m)`)); svg.appendChild(g);
        const line = (path, c, w, dsh) => { const p = document.createElementNS(SVG_NS, "path"); p.setAttribute("d", path); p.setAttribute("fill", "none"); p.setAttribute("stroke", c); p.setAttribute("stroke-width", w); p.setAttribute("stroke-linejoin", "round"); if (dsh) p.setAttribute("stroke-dasharray", dsh); svg.appendChild(p); };
        line(cPath, accent, "2"); line(mPath, T.amber, "1.5", "5,3");
        const dot = (x, y, r, f) => { const c = document.createElementNS(SVG_NS, "circle"); c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", r); c.setAttribute("fill", f); c.setAttribute("stroke", T.bg2); c.setAttribute("stroke-width", "2"); svg.appendChild(c); };
        dot(cPts[cPts.length - 1][0], cPts[cPts.length - 1][1], 4, accent);
        dot(mPts[mPts.length - 1][0], mPts[mPts.length - 1][1], 3.5, T.amber);
      }
      [40, 80, 120].forEach((v) => { const t = document.createElementNS(SVG_NS, "text"); t.setAttribute("x", "3"); t.setAttribute("y", toY(v) - 2); t.setAttribute("fill", T.text1); t.setAttribute("font-size", "8"); t.textContent = v + "°"; svg.appendChild(t); });
      slot.appendChild(svg);
    }

    _renderPhases() {
      const phases = this.state.phases, cur = this.state.currentPhase;
      const isManual = cur === 0 || /^manual$/i.test(this.state.programName || "");
      if (isManual) {
        const isStop = /^(stop|koniec|gotowe)\b/i.test(this.state.statName || "");
        const color = isStop ? T.red : T.green;
        this._slot.phases.innerHTML = `<button type="button" data-prog-pick="1" style="flex:1;text-align:center;padding:6px 0;border:1px dashed ${color}66;border-radius:6px;background:${color}11;cursor:pointer;font:inherit;"><div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.1em;">TRYB MANUAL</div></button>`;
        const btn = this._slot.phases.querySelector("[data-prog-pick]");
        if (btn) btn.addEventListener("click", () => this._openProgramSelect());
        return;
      }
      this._slot.phases.innerHTML = phases.map((ph, i) => {
        if (ph && ph.hidden) return "";
        const active = i === cur, done = i < cur, color = ph.color || T.indigo;
        const lc = active ? color : (done ? color + "aa" : T.text1);
        return `<div style="flex:1;min-width:0;text-align:center;"><div style="height:4px;border-radius:2px;background:${(done || active) ? color : T.border};margin-bottom:5px;${active ? `box-shadow:0 0 6px ${color};` : ""}"></div><div style="font-size:9px;line-height:1.05;color:${lc};font-weight:${active ? 600 : 400};overflow-wrap:anywhere;">${esc(ph.label || "")}</div></div>`;
      }).join("");
    }

    _renderProgress() {
      const off = !this.state.online;
      const total = off ? 0 : (this.state.totalMinutes || 0), elapsed = off ? 0 : (this.state.elapsedMinutes || 0);
      const pct = total > 0 ? Math.min((elapsed / total) * 100, 100) : 0;
      this._slot.progress.style.width = pct + "%";
      this._slot.time.textContent = off ? "— / —" : `${formatTime(elapsed)} / ${formatTime(total)}`;
    }

    _renderChips() {
      const accent = T.green, phases = this.state.phases, cur = this.state.currentPhase | 0;
      const ph = phases[cur] || phases[0], phColor = (ph && ph.color) || T.indigo;
      const off = !this.state.online, isManual = cur === 0 || /^manual$/i.test(this.state.programName || "");
      const vis = phases.filter((p) => p && !p.hidden);
      const visCur = phases.slice(0, cur + 1).filter((p) => p && !p.hidden).length;
      const stage = (off || isManual) ? "—" : `${Math.max(1, Math.min(visCur, vis.length))}/${vis.length}`;
      const heaterOn = !off && this.state.heaterOn;
      const chips = [
        { label: "Grzałka", value: heaterOn ? "ON" : "OFF", color: heaterOn ? accent : T.text1 },
        { label: "Etap", value: stage, color: (off || isManual) ? T.text1 : phColor },
      ];
      this._slot.chips.innerHTML = chips.map(({ label, value, color }) =>
        `<div style="background:${T.bg0};border-radius:8px;padding:7px 8px;border:1px solid ${color}44;text-align:center;"><div style="font-size:9px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">${esc(label)}</div><div style="font-size:13px;font-weight:700;color:${color};">${esc(value)}</div></div>`).join("");
    }

    _renderControls() {
      const host = this._slot.controls; if (!host) return;
      const off = !this.state.online, triac = this.state.ctrlMode === "TRIAC";
      const stopped = /^(stop|koniec|gotowe)\b/i.test(this.state.statName || "");
      if (stopped) this._runLocked = true;
      const locked = this._runLocked;
      let runBtn;
      if (stopped) {
        runBtn = `<button type="button" data-cmd="run" ${off ? "disabled" : ""} style="width:100%;padding:9px 0;border-radius:8px;border:1px solid ${T.green}88;background:${T.green}1c;color:${T.green};font-weight:700;font-size:13px;cursor:pointer;${off ? "opacity:.4;cursor:not-allowed;" : ""}">▶ START</button>`;
      } else {
        const blk = off || locked;
        const stopBtn = `<button type="button" data-cmd="run" ${blk ? "disabled" : ""} style="flex:1;padding:9px 0;border-radius:8px;border:1px solid ${T.red}88;background:${T.red}1c;color:${T.red};font-weight:700;font-size:13px;cursor:pointer;${blk ? "opacity:.45;cursor:not-allowed;" : ""}">■ STOP</button>`;
        const lc = locked ? T.amber : T.green;
        const lockBtn = `<button type="button" data-cmd="lock" ${off ? "disabled" : ""} style="width:48px;flex:0 0 48px;padding:9px 0;border-radius:8px;border:1px solid ${lc}88;background:${lc}1c;color:${lc};font-size:15px;cursor:pointer;${off ? "opacity:.4;" : ""}">${locked ? "🔒" : "🔓"}</button>`;
        runBtn = `<div style="display:flex;gap:8px;">${stopBtn}${lockBtn}</div>`;
      }
      this._slot.run.innerHTML = runBtn;

      const outputs = [
        { key: "dym", label: "Dym", pct: this.state.dymPct, on: this.state.dymOn, color: T.amber },
        { key: "fan1", label: "FAN 1", pct: this.state.fan1Pct, on: this.state.fan1On, color: T.indigo },
        { key: "fan2", label: "FAN 2", pct: this.state.fan2Pct, on: this.state.fan2On, color: T.indigoL },
      ];
      const outBlocked = off || stopped, outDis = outBlocked ? "disabled" : "";
      const cell = (inner, blk) => `<div style="background:${T.bg0};border:1px solid ${T.border};border-radius:8px;padding:8px;${(blk === undefined ? outBlocked : blk) ? "opacity:.45;" : ""}">${inner}</div>`;
      const outHtml = outputs.map((o) => {
        const head = `<div style="font-size:9px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${esc(o.label)}</div>`;
        if (triac) return cell(`${head}<div style="display:flex;align-items:center;gap:6px;"><input type="range" min="0" max="100" step="1" value="${o.pct | 0}" data-pwr="${o.key}" ${outDis} style="flex:1;height:5px;${outBlocked ? "cursor:not-allowed;" : ""}"><span data-pwrval="${o.key}" style="font-size:11px;font-weight:700;color:${o.on ? o.color : T.text1};min-width:30px;text-align:right;">${o.pct | 0}%</span></div>`);
        return cell(`${head}<button type="button" data-tgl="${o.key}" ${outDis} style="width:100%;padding:6px 0;border-radius:6px;border:1px solid ${o.on ? o.color : T.border};background:${o.on ? o.color + "22" : T.bg0};color:${o.on ? o.color : T.text1};font-weight:700;font-size:12px;cursor:pointer;${outBlocked ? "cursor:not-allowed;" : ""}">${o.on ? "ON" : "OFF"}</button>`);
      }).join("");
      const lightOn = this.state.lightOn;
      const lightCell = cell(`<div style="font-size:9px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Światło</div><button type="button" data-tgl="light" ${off ? "disabled" : ""} style="width:100%;padding:6px 0;border-radius:6px;border:1px solid ${lightOn ? "#FCD34D" : T.border};background:${lightOn ? "#FCD34D22" : T.bg0};color:${lightOn ? "#FCD34D" : T.text1};font-weight:700;font-size:12px;cursor:pointer;${off ? "opacity:.4;" : ""}">${lightOn ? "ON" : "OFF"}</button>`, off);
      host.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;">${outHtml}${lightCell}</div>`;

      if (off) return;
      const lockEl = this._slot.run.querySelector('button[data-cmd="lock"]');
      if (lockEl) lockEl.addEventListener("click", () => { this._runLocked = !this._runLocked; this._renderControls(); });
      const runEl = this._slot.run.querySelector('button[data-cmd="run"]');
      if (runEl) runEl.addEventListener("click", () => {
        const goStop = !/^(stop|koniec|gotowe)\b/i.test(this.state.statName || "");
        if (goStop) { if (this._runLocked) return; this._press("stop"); }
        else this._press("start");
      });
      host.querySelectorAll("input[data-pwr]").forEach((rng) => rng.addEventListener("change", () => this._setNumber(rng.dataset.pwr, parseInt(rng.value, 10))));
      host.querySelectorAll("button[data-tgl]").forEach((btn) => btn.addEventListener("click", () => {
        const k = btn.dataset.tgl;
        if (k === "light") return this._setLight(!this.state.lightOn);
        const on = k === "dym" ? this.state.dymOn : k === "fan1" ? this.state.fan1On : this.state.fan2On;
        this._setNumber(k, on ? 0 : 100);
      }));
    }

    // ── Modale ──
    _modal(html) {
      const ex = document.body.querySelector(".twifi-sm-backdrop"); if (ex) ex.remove();
      const bd = document.createElement("div"); bd.className = "twifi-sm-backdrop"; bd.innerHTML = html;
      document.body.appendChild(bd);
      const close = () => { bd.remove(); document.removeEventListener("keydown", esch); };
      const esch = (e) => { if (e.key === "Escape") close(); };
      document.addEventListener("keydown", esch);
      bd.addEventListener("click", (e) => { if (e.target === bd) close(); });
      bd.querySelectorAll("button.cancel").forEach((b) => b.addEventListener("click", close));
      return { bd, panel: bd.querySelector(".twifi-sm-panel"), close };
    }

    _openValueEdit({ title, value, unit, step, min, max, onSave }) {
      const { panel, close } = this._modal(`<div class="twifi-sm-panel" style="max-width:300px;">
        <div class="twifi-sm-head"><span class="twifi-sm-title">${esc(title)}</span><button type="button" class="cancel" style="background:transparent;color:#EF4444;border:none;cursor:pointer;font-size:18px;">×</button></div>
        <div class="twifi-sm-row" style="grid-template-columns:1fr;border-bottom:none;"><input type="number" data-v value="${esc(String(value))}" step="${step}" min="${min}" max="${max}" inputmode="decimal" style="font-size:18px;text-align:center;"><div class="unit" style="text-align:center;">${esc(unit)}</div></div>
        <div class="twifi-sm-foot"><button type="button" class="cancel">Anuluj</button><button type="button" class="save">Zapisz</button></div></div>`);
      const input = panel.querySelector("[data-v]");
      const save = () => { const v = parseFloat(String(input.value).replace(",", ".")); if (!isFinite(v)) return; onSave(v); close(); };
      panel.querySelector(".save").addEventListener("click", save);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
      setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 30);
    }

    _openProgramSelect() {
      const cur = (this.state.programName || "").toUpperCase();
      const rows = PROGRAM_OPTIONS.map((n) => `<button type="button" data-prog="${esc(n)}" style="display:block;width:100%;padding:10px 12px;margin-bottom:6px;border:1px solid ${n === cur ? T.green : T.border};background:${n === cur ? T.green + "22" : T.bg0};color:${T.text0};border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;text-align:left;text-transform:uppercase;">${esc(n)}</button>`).join("");
      const { panel, close } = this._modal(`<div class="twifi-sm-panel" style="max-width:360px;"><div class="twifi-sm-head"><span class="twifi-sm-title">Wybór programu</span><button type="button" class="cancel" style="background:transparent;color:#EF4444;border:none;cursor:pointer;font-size:18px;">×</button></div><div>${rows}</div></div>`);
      panel.querySelectorAll("[data-prog]").forEach((b) => b.addEventListener("click", () => { this._selectProgram(b.dataset.prog); close(); }));
    }

    _openProgramEditor() {
      const rows = PROG_PARAMS.map((p) => {
        if (!this._id(p.ent)) return "";
        const cur = this.state.programParams[p.ent];
        const valStr = cur != null ? (Number.isInteger(p.step) ? Math.round(cur) : cur) : "";
        const live = cur != null ? `${Number.isInteger(p.step) ? Math.round(cur) : cur.toFixed(1)} ${p.unit}` : "—";
        return `<div class="twifi-sm-row"><label><span>${esc(p.label)}</span><span class="unit">[${esc(p.unit)}]</span><div class="live">akt: ${esc(live)}</div></label><input type="number" data-pk="${p.ent}" value="${valStr}" step="${p.step}" inputmode="decimal"></div>`;
      }).join("");
      const { panel, close } = this._modal(`<div class="twifi-sm-panel"><div class="twifi-sm-head"><span class="twifi-sm-title">Program własny</span><button type="button" class="cancel" style="background:transparent;color:#EF4444;border:none;cursor:pointer;font-size:18px;">×</button></div>${rows}<div class="twifi-sm-foot"><button type="button" class="cancel">Anuluj</button><button type="button" class="save">Zapisz</button></div></div>`);
      panel.querySelector(".save").addEventListener("click", () => {
        PROG_PARAMS.forEach((p) => {
          const inp = panel.querySelector(`[data-pk="${p.ent}"]`); if (!inp) return;
          const raw = String(inp.value).trim(); if (raw === "") return;
          const v = parseFloat(raw.replace(",", ".")); if (isNaN(v)) return;
          this._setNumber(p.ent, Number.isInteger(p.step) ? Math.round(v) : v);
        });
        close();
      });
    }

    // ════════════════ TRYB MODERN (vendorowany widget z aplikacji) ════════════════

    _loadWidget() {
      if (window.IoTWidgets && window.IoTWidgets.smoker) return Promise.resolve();
      if (window.__twifiWidgetLoading) return window.__twifiWidgetLoading;
      window.__twifiWidgetLoading = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = `/${DOMAIN}/widget-smoker.js`;
        s.async = true;
        s.onload = () => res();
        s.onerror = () => rej(new Error("widget load failed"));
        document.head.appendChild(s);
      });
      return window.__twifiWidgetLoading;
    }

    async _mountModern() {
      try {
        await this._loadWidget();
      } catch (e) {
        this._err("Nie udało się wczytać widgetu (modern). Sprawdź zasób /termometrwifi/widget-smoker.js.");
        return;
      }
      const Widget = window.IoTWidgets && window.IoTWidgets.smoker;
      if (!Widget) { this._err("Widget smoker niedostępny."); return; }
      this.shadowRoot.innerHTML = "";
      const host = document.createElement("div");
      this.shadowRoot.appendChild(host);
      this._subs = {};
      this._widget = new Widget(this._cfgModern(), this._ctxShim());
      this._widget.mount(host);
      this._dispatchModern(true);
    }

    _cfgModern() {
      return {
        id: "ha_" + (this._sn || "smoker"),
        label: this._deviceName, device_name: this._deviceName,
        chamber_label: this._chamberLabel, meat_label: this._meatLabel,
        unit: this._config.unit || "°C",
        accent_color: this._config.accent_color || "#10B981",
        time_unit_seconds: true,
        // PUB (odczyt)
        chamber_temp_topic_suffix: "PUB/T/tDym", meat_temp_topic_suffix: "PUB/T/tWsad",
        target_chamber_topic_suffix: "PUB/TDM", target_meat_topic_suffix: "PUB/TWM",
        elapsed_topic_suffix: "PUB/elapsed", total_topic_suffix: "PUB/total",
        phase_topic_suffix: "PUB/AKTUAL", heater_topic_suffix: "PUB/output",
        fan1_topic_suffix: "PUB/FAN1", fan2_topic_suffix: "PUB/FAN2", dym_topic_suffix: "PUB/DYM",
        light_topic_suffix: "PUB/LED", ctrl_topic_suffix: "PUB/CTRL",
        program_topic_suffix: "PUB/PROG", recipe_topic_suffix: "PUB/przepis",
        stat_topic_suffix: "PUB/STAT", czas_topic_suffix: "PUB/Czas", wifi_rssi_topic_suffix: "PUB/signal",
        // SUB (zapis)
        fan1_sub_topic_suffix: "SUB/FAN1", fan2_sub_topic_suffix: "SUB/FAN2", dym_sub_topic_suffix: "SUB/DYM",
        light_sub_topic_suffix: "SUB/LED", stat_sub_topic_suffix: "SUB/STAT",
        program_sub_topic_suffix: "SUB/PROG", tdm_sub_topic_suffix: "SUB/TDM",
        twm_sub_topic_suffix: "SUB/TWM", czas_sub_topic_suffix: "SUB/Czas",
        // parametry programu WLASNY (pub/sub)
        prog_dripping_pub_topic_suffix: "PUB/ocCW", prog_dripping_sub_topic_suffix: "SUB/ocCW",
        prog_drying_pub_topic_suffix: "PUB/osCW", prog_drying_sub_topic_suffix: "SUB/osCW",
        prog_smoking_pub_topic_suffix: "PUB/wCW", prog_smoking_sub_topic_suffix: "SUB/wCW",
        prog_baking_pub_topic_suffix: "PUB/pCW", prog_baking_sub_topic_suffix: "SUB/pCW",
        prog_heat_temp_pub_topic_suffix: "PUB/tRW", prog_heat_temp_sub_topic_suffix: "SUB/tRW",
        prog_dry_temp_pub_topic_suffix: "PUB/tSW", prog_dry_temp_sub_topic_suffix: "SUB/tSW",
        prog_smoke_temp_pub_topic_suffix: "PUB/tWW", prog_smoke_temp_sub_topic_suffix: "SUB/tWW",
        prog_bake_temp_pub_topic_suffix: "PUB/tPW", prog_bake_temp_sub_topic_suffix: "SUB/tPW",
        prog_meat_max_pub_topic_suffix: "PUB/tWMW", prog_meat_max_sub_topic_suffix: "SUB/tWMW",
      };
    }

    _ctxShim() {
      const self = this;
      return {
        sn: this._sn,
        sse: {
          on(topic, cb) { (self._subs[topic] = self._subs[topic] || []).push(cb); },
          publish(topic, payload) { return self._publishModern(topic, payload); },
        },
      };
    }

    _modernSources() {
      return [
        ["PUB/T/tDym", "chamber"], ["PUB/T/tWsad", "meat"],
        ["PUB/TDM", "target_chamber"], ["PUB/TWM", "target_meat"],
        ["PUB/elapsed", "elapsed"], ["PUB/total", "total"],
        ["PUB/AKTUAL", "phase"], ["PUB/output", "heater"],
        ["PUB/FAN1", "fan1"], ["PUB/FAN2", "fan2"], ["PUB/DYM", "dym"],
        ["PUB/LED", "light"], ["PUB/CTRL", "ctrl"], ["PUB/PROG", "program"],
        ["PUB/przepis", "recipe"], ["PUB/STAT", "status"], ["PUB/Czas", "clock"],
        ["PUB/signal", "rssi"],
        ["PUB/ocCW", "w_dripping"], ["PUB/osCW", "w_drying"], ["PUB/wCW", "w_smoking"],
        ["PUB/pCW", "w_baking"], ["PUB/tRW", "w_heat"], ["PUB/tSW", "w_dry"],
        ["PUB/tWW", "w_smoke"], ["PUB/tPW", "w_bake"], ["PUB/tWMW", "w_meat_max"],
      ];
    }

    /** Pcha bieżące wartości encji do widgetu jako "wiadomości MQTT". */
    _dispatchModern(force) {
      if (!this._widget || !this._subs) return;
      const sn = this._sn;
      const fire = (topic, val) => {
        if (val == null) return;
        if (!force && this._last[topic] === val) return;
        this._last[topic] = val;
        (this._subs[topic] || []).forEach((cb) => { try { cb(val); } catch (e) {} });
      };
      const chamberS = this._stateObj("chamber");
      const online = !(!chamberS || chamberS.state === "unavailable" || chamberS.state === "unknown");
      fire(sn + "/status", online ? "online" : "offline");
      for (const [suf, key] of this._modernSources()) {
        const s = this._stateObj(key);
        if (!s) continue;
        let v;
        if (key === "phase") v = (s.attributes && s.attributes.index != null) ? String(s.attributes.index) : String(s.state);
        else if (key === "light") v = s.state === "on" ? "1" : "0";
        else v = String(s.state);
        if (v === "unavailable" || v === "unknown") continue;
        fire(sn + "/" + suf, v);
      }
    }

    /** Publikacja z widgetu (SUB/*) → serwis HA. Zwraca Promise (widget bywa await). */
    _publishModern(topic, payload) {
      const sn = this._sn;
      let suffix = topic;
      if (sn && topic.indexOf(sn + "/") === 0) suffix = topic.slice(sn.length + 1);
      const p = String(payload);
      const n = parseFloat(p.replace(",", "."));
      const call = (d, s, data) => this._hass.callService(d, s, data);
      const setN = (key, val) => { const id = this._id(key); return id ? call("number", "set_value", { entity_id: id, value: val }) : Promise.resolve(); };
      const map = {
        "SUB/TDM": () => setN("target_chamber", n), "SUB/TWM": () => setN("target_meat", n),
        "SUB/DYM": () => setN("dym", Math.round(n)), "SUB/FAN1": () => setN("fan1", Math.round(n)), "SUB/FAN2": () => setN("fan2", Math.round(n)),
        "SUB/LED": () => { const id = this._id("light"); return id ? call("switch", n > 0 ? "turn_on" : "turn_off", { entity_id: id }) : Promise.resolve(); },
        "SUB/PROG": () => { const id = this._id("program"); return id ? call("select", "select_option", { entity_id: id, option: p.toUpperCase() }) : Promise.resolve(); },
        "SUB/STAT": () => { const id = this._id(/^start$/i.test(p) ? "start" : "stop"); return id ? call("button", "press", { entity_id: id }) : Promise.resolve(); },
        "SUB/ocCW": () => setN("w_dripping", Math.round(n)), "SUB/osCW": () => setN("w_drying", Math.round(n)),
        "SUB/wCW": () => setN("w_smoking", Math.round(n)), "SUB/pCW": () => setN("w_baking", Math.round(n)),
        "SUB/tRW": () => setN("w_heat", n), "SUB/tSW": () => setN("w_dry", n), "SUB/tWW": () => setN("w_smoke", n),
        "SUB/tPW": () => setN("w_bake", n), "SUB/tWMW": () => setN("w_meat_max", n),
      };
      const fn = map[suffix];
      if (fn) return Promise.resolve(fn());
      // np. SUB/Czas — brak odpowiedniej encji; nie blokujemy UI widgetu
      return Promise.resolve();
    }
  }

  if (!customElements.get("termometrwifi-smoker-card"))
    customElements.define("termometrwifi-smoker-card", TermometrWifiSmokerCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "termometrwifi-smoker-card",
    name: "TermometrWifi — Wędzarnia",
    description: "Karta wędzarni. Styl: 'modern' (1:1 widget z aplikacji) lub 'classic' (lekki, w stylu HA). Opcje: style, chamber_label, meat_label, device_id.",
    preview: false,
  });
  console.info("%c TERMOMETRWIFI-SMOKER-CARD ", "background:#10B981;color:#fff;border-radius:3px");
})();
