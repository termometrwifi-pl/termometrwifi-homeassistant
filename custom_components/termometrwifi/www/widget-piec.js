(function () {
  'use strict';

  // ── Tokeny motywu (czytane z CSS variables, fallback = dark) ───────────────
  const T = new Proxy({
    bg0:    ['--iot-bg',      '#0F1115'],
    bg1:    ['--iot-bg-2',    '#14171F'],
    bg2:    ['--iot-card',    '#1A1D24'],
    bg3:    ['--iot-card-2',  '#232730'],
    border: ['--iot-border',  '#2A2F3A'],
    text0:  ['--iot-text',    '#E6E8EC'],
    text1:  ['--iot-text-dim','#8A92A6'],
    indigo: ['--iot-accent',  '#6366F1'],
    indigoL:['--iot-accent-2','#818CF8'],
    green:  ['--iot-success', '#10B981'],
    amber:  ['--iot-warn',    '#F59E0B'],
    red:    ['--iot-danger',  '#EF4444'],
    flame:  ['--iot-flame',   '#F97316'],
    water:  ['--iot-water',   '#38BDF8'],
  }, {
    get(target, prop) {
      const e = target[prop];
      if (!e) return undefined;
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(e[0]).trim();
        return v || e[1];
      } catch (_) { return e[1]; }
    }
  });

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function num(p, fb) { const v = parseFloat(p); return isNaN(v) ? fb : v; }
  function bool(p) {
    if (p === true || p === 1) return true;
    const s = String(p ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'on';
  }
  const fmt = (v, d = 0) => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d);
  const DAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

  // Mapowanie stanu kotła → etykieta PL + kolor (state_name() z firmware).
  const STATE_META = {
    EXTINGUISHED: { label: 'Wygaszony',  color: T.text1 },
    IGNITION:     { label: 'Rozpalanie', color: T.amber },
    RUNNING:      { label: 'Praca',      color: T.green },
    BURNDOWN:     { label: 'Wygaszanie', color: T.flame },
    SAFETY:       { label: 'Awaria',     color: T.red },
  };
  function stateMeta(s) {
    return STATE_META[String(s || '').toUpperCase()] || { label: String(s || '—'), color: T.text1 };
  }

  const ALARM_NAMES = {
    ALARM_SENSOR_FAIL: 'Awaria czujnika',
    ALARM_NO_RTC: 'Brak zegara RTC',
    ALARM_OVERHEAT: 'Przegrzanie',
    ALARM_NO_FUEL: 'Brak paliwa',
    ALARM_DOOR_OPEN: 'Otwarte drzwiczki',
    ALARM_PRESSURE: 'Ciśnienie',
    ALARM_FLAME_LOSS: 'Zanik płomienia',
  };
  function alarmName(code) {
    const c = String(code || '').toUpperCase();
    return ALARM_NAMES[c] || c.replace(/^ALARM_/, '').replace(/_/g, ' ');
  }

  // Domyślne sufiksy topiców = ścieżki publikowane przez firmware piecv2 (mqtt_mgr.c).
  const DEF = {
    rssi: 'wifi/rssi',
    t_piec: 'temp/piec', t_co: 'temp/co', t_cwu: 'temp/cwu', t_zew: 'temp/zew', t_spaliny: 'temp/spaliny',
    fire: 'fire/present', fan_pct: 'fan/pct',
    relay_co: 'relay/co', relay_cwu: 'relay/cwu',
    state: 'state', mode: 'mode', nastaw: 'nastaw', safety: 'safety',
    tryb_letni: 'tryb_letni', pressure: 'pressure/bar',
    feeder: 'fuel/feeder', feeder_act: 'fuel/feeder/active',
    tank_pct: 'fuel/tank/remaining_pct', eta_str: 'fuel/predictor/eta_str',
    cost_per_kg: 'fuel/cost_per_kg', avg_load: 'fuel/avg_load_kg',
    kg_today: 'fuel/stats/kg_today', pln_today: 'fuel/stats/pln_today', kg_week: 'fuel/stats/kg_week',
    alarm_count: 'alarm_count', alarms: 'alarms',
  };

  // Domyślne ustawienia lokalne (krzywa/harmonogramy/offsety — bez bezpośredniego API w FW,
  // trzymane per-widget w localStorage; tryb letni i koszt synchronizowane komendami MQTT).
  const SETTINGS_DEFAULTS = {
    summer: false,
    costPerKg: 1.45,
    serviceDays: 28,
    offsets: { supply: 0, ret: 0, cwu: 0, outside: 0, flue: 0 },
    curve: [
      { outside: -20, supply: 75 }, { outside: -10, supply: 68 },
      { outside: 0, supply: 58 }, { outside: 10, supply: 48 }, { outside: 20, supply: 38 },
    ],
    schedules: [
      { id: 'sc1', name: 'Dzień roboczy', active: true, days: [true, true, true, true, true, false, false], from: '06:00', to: '22:00', temp: 70 },
      { id: 'sc2', name: 'Noc', active: true, days: [true, true, true, true, true, true, true], from: '22:00', to: '06:00', temp: 55 },
    ],
  };

  function injectCss() {
    if (document.getElementById('iot-piec-css')) return;
    const st = document.createElement('style');
    st.id = 'iot-piec-css';
    st.textContent = `
      @keyframes iotPiecFade { from { opacity: 0 } to { opacity: 1 } }
      .iot-piec-modal-bk { position:fixed; inset:0; background:rgba(0,0,0,.65); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; }
      .iot-piec-modal { width:100%; max-width:320px; background:var(--iot-bg-2,#14171F); border:1px solid var(--iot-border,#2A2F3A); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:12px; box-shadow:0 20px 60px rgba(0,0,0,.5); }
      .iot-piec-modal h4 { margin:0; font-size:13px; font-weight:700; color:var(--iot-text,#E6E8EC); text-transform:uppercase; letter-spacing:.06em; }
      .iot-piec-modal input { width:100%; padding:9px 10px; background:var(--iot-bg,#0F1115); color:var(--iot-text,#E6E8EC); border:1px solid var(--iot-border,#2A2F3A); border-radius:8px; font-size:18px; text-align:center; font-family:inherit; box-sizing:border-box; font-variant-numeric:tabular-nums; }
      .iot-piec-modal input:focus { outline:none; border-color:var(--iot-accent,#6366F1); }
      .iot-piec-modal .row { display:flex; gap:8px; }
      .iot-piec-modal button { flex:1; padding:9px 0; border:none; border-radius:999px; cursor:pointer; font-size:12px; font-weight:600; font-family:inherit; }
      .iot-piec-modal .save { background:var(--iot-accent,#6366F1); color:#fff; }
      .iot-piec-modal .cancel { background:var(--iot-card,#1A1D24); color:var(--iot-text,#E6E8EC); border:1px solid var(--iot-border,#2A2F3A); }
      .iot-piec-overlay { position:absolute; inset:0; background:rgba(8,10,14,.9); z-index:50; padding:12px; display:flex; animation:iotPiecFade .15s ease-out; }
      .iot-piec-overlay input { font-family:inherit; }
      .iot-piec-ibtn { width:24px; height:24px; border-radius:6px; background:var(--iot-bg,#0F1115); color:var(--iot-text,#E6E8EC); border:1px solid var(--iot-border,#2A2F3A); font-size:14px; font-weight:600; line-height:1; cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; flex:none; }
    `;
    document.head.appendChild(st);
  }

  class PiecWidget {
    constructor(cfg, ctx) {
      this.cfg = cfg || {};
      this.ctx = ctx || {};
      this.el = null;
      this._slot = {};
      this._raf = 0;
      this._dirty = new Set();

      const cd = (k, def) => { const ck = k + '_topic_suffix'; if (!this.cfg[ck]) this.cfg[ck] = def; };
      Object.entries(DEF).forEach(([k, v]) => cd(k, v));

      this.settings = this._loadSettings();

      this.state = {
        online: true,
        rssi: null,
        tPiec: null, tCo: null, tCwu: null, tZew: null, tSpaliny: null,
        fire: false, fanPct: 0,
        pumpCo: false, pumpCwu: false,
        boilerState: '', mode: '', nastaw: null, safety: false,
        trybLetni: false, pressure: null,
        hasFeeder: false, feederActive: false,
        tankPct: null, etaStr: '',
        kgToday: null, plnToday: null, kgWeek: null, avgLoad: 5,
        alarmCount: 0, alarms: [],
      };
      this._targetPending = null; // wartość suwaka w trakcie przeciągania

      this.history = [];
      this.MEM_CAP = 5000;
      this.viewCount = Math.max(20, num(this.cfg.history_size, 60) | 0);
    }

    /* ───────── ustawienia (localStorage) ───────── */

    _settingsKey() {
      const sn = (this.ctx && this.ctx.sn) ? String(this.ctx.sn) : '';
      const id = (this.cfg && this.cfg.id) || 'piec';
      return 'iot:piec:' + sn + ':' + id + ':settings';
    }
    _loadSettings() {
      let s = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
      try {
        const raw = localStorage.getItem(this._settingsKey());
        if (raw) {
          const p = JSON.parse(raw);
          s = Object.assign(s, p);
          s.offsets = Object.assign({}, SETTINGS_DEFAULTS.offsets, p.offsets || {});
        }
      } catch (_) {}
      if (this.cfg.cost_per_kg != null && s.costPerKg == null) s.costPerKg = num(this.cfg.cost_per_kg, 1.45);
      return s;
    }
    _saveSettings() {
      try { localStorage.setItem(this._settingsKey(), JSON.stringify(this.settings)); } catch (_) {}
    }

    /* ───────── offsety czujników (kompensacja wskazań) ───────── */

    _off(key) { return num(this.settings.offsets && this.settings.offsets[key], 0); }
    get _supply() { return this.state.tPiec == null ? null : this.state.tPiec + this._off('supply'); }
    get _ret()    { return this.state.tCo   == null ? null : this.state.tCo   + this._off('ret'); }
    get _cwu()    { return this.state.tCwu  == null ? null : this.state.tCwu  + this._off('cwu'); }
    get _zew()    { return this.state.tZew  == null ? null : this.state.tZew  + this._off('outside'); }
    get _flue()   { return this.state.tSpaliny == null ? null : this.state.tSpaliny + this._off('flue'); }

    /* ───────── mount / render ───────── */

    mount(parent) {
      injectCss();
      this.el = document.createElement('div');
      this.el.className = 'iot-widget iot-widget--piec' + (this.cfg.bare ? ' iot-widget--bare' : '');
      this._applyContainerStyle();
      this.el.innerHTML = this._tpl();
      parent.appendChild(this.el);
      this._cacheRefs();
      this._renderAll();
      this._subscribe();
      this._hydrateFromDB();
      this._attachActions();
      if (window.IoTBaseWidget && window.IoTBaseWidget._instances) {
        window.IoTBaseWidget._instances.add(this);
      }
    }

    render() {
      if (!this.el) return;
      const overlayOpen = this._slot.overlay && this._slot.overlay.dataset.open === '1';
      this._applyContainerStyle();
      this.el.innerHTML = this._tpl();
      this._cacheRefs();
      this._renderAll();
      this._attachActions();
      if (overlayOpen) this._openSettings();
    }

    _applyContainerStyle() {
      const accent = this.cfg.accent_color || T.indigoL;
      const s = this.el.style;
      s.width = '100%';
      s.maxWidth = '';
      s.background = T.bg1;
      s.border = `1px solid ${T.border}`;
      s.borderTop = `3px solid ${accent}`;
      s.borderRadius = '14px';
      s.position = 'relative';
      s.overflowX = 'hidden';
      s.overflowY = 'auto';
      s.webkitOverflowScrolling = 'touch';
      s.color = T.text0;
      s.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      s.boxShadow = `0 0 0 1px ${accent}22, 0 8px 32px rgba(0,0,0,.35)`;
    }

    _tpl() {
      return `
        <div data-slot="header" style="padding:10px 14px;background:${T.bg0};display:flex;align-items:center;justify-content:space-between;gap:8px;"></div>
        <div data-slot="statusbar" style="display:grid;grid-template-columns:1fr 1fr 1fr;background:${T.bg2};border-bottom:1px solid ${T.border};font-size:10px;"></div>
        <div style="padding:12px 14px 0;position:relative;" data-slot="schematic-wrap"></div>
        <div style="padding:4px 14px 14px;">
          <div data-slot="setpoint"></div>
          <div data-slot="ministatus" style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:6px 0 12px;"></div>
          <div data-slot="chart" style="background:${T.bg0};border-radius:10px;padding:10px 12px;margin-bottom:12px;border:1px solid ${T.border};"></div>
          <div data-slot="fuelbar" style="background:${T.bg2};border:1px solid ${T.border};border-radius:10px;padding:10px 12px;margin-bottom:10px;"></div>
          <div data-slot="consumption" style="background:${T.bg2};border:1px solid ${T.border};border-radius:10px;padding:10px 12px;margin-bottom:12px;"></div>
          <div data-slot="actions" style="display:flex;gap:8px;position:relative;"></div>
        </div>
        <div data-slot="overlay" data-open="0"></div>`;
    }

    _cacheRefs() {
      const q = (n) => this.el.querySelector(`[data-slot="${n}"]`);
      this._slot = {
        header: q('header'), statusbar: q('statusbar'), schematicWrap: q('schematic-wrap'),
        setpoint: q('setpoint'), ministatus: q('ministatus'), chart: q('chart'),
        fuelbar: q('fuelbar'), consumption: q('consumption'), actions: q('actions'), overlay: q('overlay'),
      };
    }

    _renderAll() {
      this._renderHeader();
      this._renderStatusbar();
      this._renderSchematic();
      this._renderSetpoint();
      this._renderMiniStatus();
      this._renderChart();
      this._renderFuelbar();
      this._renderConsumption();
      this._renderActions();
    }

    _mark(part) {
      this._dirty.add(part);
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        const d = this._dirty; this._dirty = new Set();
        if (d.has('header'))      this._renderHeader();
        if (d.has('statusbar'))   this._renderStatusbar();
        if (d.has('schematic'))   this._renderSchematic();
        if (d.has('setpoint'))    this._renderSetpoint();
        if (d.has('ministatus'))  this._renderMiniStatus();
        if (d.has('chart'))       this._renderChart();
        if (d.has('fuelbar'))     this._renderFuelbar();
        if (d.has('consumption')) this._renderConsumption();
      });
    }

    label() {
      try {
        const sn = (this.ctx && this.ctx.sn) ? String(this.ctx.sn) : '';
        const id = this.cfg && this.cfg.id;
        if (id) {
          const v = localStorage.getItem('iot:' + sn + ':' + sn + ':' + id + ':label');
          if (v) return v;
        }
      } catch (_) {}
      return this.cfg.label || '';
    }

    /* ───────── nagłówek ───────── */

    _renderHeader() {
      const h = this._slot.header; if (!h) return;
      const summer = this.settings.summer;
      const off = !this.state.online;
      const dotColor = off ? T.text1 : (summer ? T.water : T.green);
      const modeTxt = summer ? '☀ LATO' : ((this.state.mode || 'AUTO').toUpperCase());
      const modeColor = summer ? T.water : (this.state.mode === 'MANUAL' ? T.amber : T.green);
      h.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};box-shadow:0 0 6px ${dotColor};flex-shrink:0;"></span>
          <span style="font-size:11px;font-weight:600;color:${T.text0};text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${esc(this.label() || 'Kocioł CO · Schemat')}
          </span>
        </div>
        <span style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;">
          ${off ? `<span style="color:${T.red};font-weight:600;">OFFLINE</span>` : `Tryb: <span style="color:${modeColor};font-weight:600;">${esc(modeTxt)}</span>`}
        </span>`;
    }

    /* ───────── pasek statusu: Faza · Alarmy · Serwis ───────── */

    _renderStatusbar() {
      const host = this._slot.statusbar; if (!host) return;
      const sm = stateMeta(this.state.boilerState);
      const alarms = Array.isArray(this.state.alarms) ? this.state.alarms : [];
      const top = alarms[0];
      const aColor = top ? T.red : T.green;
      const serviceDays = this.settings.serviceDays ?? 28;
      const serviceWarn = serviceDays <= 7;
      host.innerHTML = `
        <div style="padding:7px 10px;display:flex;align-items:center;gap:6px;border-right:1px solid ${T.border};min-width:0;" title="Stan kotła">
          <span style="width:6px;height:6px;border-radius:50%;background:${sm.color};box-shadow:0 0 5px ${sm.color};flex:none;"></span>
          <span style="color:${T.text1};text-transform:uppercase;letter-spacing:.05em;font-size:9px;">Faza</span>
          <span style="color:${sm.color};font-weight:600;text-transform:uppercase;letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:auto;">${esc(sm.label)}</span>
        </div>
        <div style="padding:7px 10px;display:flex;align-items:center;gap:6px;border-right:1px solid ${T.border};min-width:0;" title="${esc(alarms.map(alarmName).join(' · ') || 'Brak alarmów')}">
          <span style="color:${aColor};font-size:11px;line-height:1;${top ? `filter:drop-shadow(0 0 4px ${aColor});` : ''}">${top ? '⚠' : '✓'}</span>
          <span style="color:${aColor};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;">${top ? esc(alarmName(top)) : 'Brak alarmów'}</span>
          ${alarms.length > 1 ? `<span style="margin-left:auto;background:${aColor}22;color:${aColor};font-size:9px;font-weight:700;border-radius:999px;padding:1px 6px;">+${alarms.length - 1}</span>` : ''}
        </div>
        <div style="padding:7px 10px;display:flex;align-items:center;gap:6px;min-width:0;" title="Czyszczenie wymiennika">
          <span style="color:${serviceWarn ? T.amber : T.text1};font-size:11px;line-height:1;">⛭</span>
          <span style="color:${T.text1};text-transform:uppercase;letter-spacing:.05em;font-size:9px;">Serwis</span>
          <span style="color:${serviceWarn ? T.amber : T.text0};font-weight:600;font-variant-numeric:tabular-nums;margin-left:auto;">${serviceDays} dni</span>
        </div>`;
    }

    /* ───────── schemat hydrauliczny ───────── */

    _renderSchematic() {
      const wrap = this._slot.schematicWrap; if (!wrap) return;
      const s = this.state;
      const flamePct = s.fire ? Math.max(15, s.fanPct) : (s.fanPct > 0 ? s.fanPct : 0);
      const burning = s.fire || s.boilerState === 'RUNNING' || s.boilerState === 'IGNITION';
      const feederOn = s.hasFeeder && s.feederActive;
      const tankPct = s.tankPct == null ? 0 : Math.max(0, Math.min(100, s.tankPct));
      const pumpCo = s.pumpCo;
      const flue = this._flue, supply = this._supply, ret = this._ret, cwu = this._cwu;
      const pressure = s.pressure;

      const sig = [Math.round(flamePct / 8), burning, feederOn, Math.round(tankPct / 4), pumpCo,
                   Math.round(num(supply, 0)), Math.round(num(ret, 0)), Math.round(num(cwu, 0)),
                   Math.round(num(flue, 0)), pressure == null ? 'n' : Math.round(pressure * 10), s.hasFeeder].join('|');
      if (sig === this._schemSig) return;
      this._schemSig = sig;

      const flameScale = 0.5 + Math.min(1, flamePct / 100) * 0.6;
      const hopper = s.hasFeeder ? this._svgHopperAuger(tankPct, feederOn) : '';

      wrap.innerHTML = `
        <svg viewBox="0 -60 360 300" width="100%" style="display:block;overflow:visible;">
          <defs>
            <linearGradient id="piecPipeHot" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stop-color="${T.flame}" stop-opacity="0.9"/><stop offset="100%" stop-color="${T.amber}" stop-opacity="0.9"/>
            </linearGradient>
            <linearGradient id="piecPipeRet" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stop-color="#60A5FA" stop-opacity="0.7"/><stop offset="100%" stop-color="${T.indigoL}" stop-opacity="0.7"/>
            </linearGradient>
            <radialGradient id="piecFlameGlow" cx="50%" cy="65%" r="55%">
              <stop offset="0%" stop-color="${T.amber}" stop-opacity="0.85"/><stop offset="50%" stop-color="${T.flame}" stop-opacity="0.6"/><stop offset="100%" stop-color="${T.flame}" stop-opacity="0"/>
            </radialGradient>
          </defs>

          ${this._svgChimney(28, -3, flue, burning)}

          <rect x="20" y="60" width="100" height="130" rx="10" fill="${T.bg2}" stroke="${T.border}" stroke-width="1.2"/>
          <rect x="20" y="60" width="100" height="22" rx="10" fill="${T.bg3}"/>
          <text x="70" y="76" text-anchor="middle" fill="${T.text0}" font-size="10" font-weight="600" letter-spacing="1.2">KOCIOŁ</text>

          <rect x="40" y="100" width="60" height="60" rx="6" fill="#08090C" stroke="${T.flame}55" stroke-width="1"/>
          ${burning ? `
          <ellipse cx="70" cy="138" rx="${22 * flameScale}" ry="${26 * flameScale}" fill="url(#piecFlameGlow)">
            <animate attributeName="ry" values="${24 * flameScale};${28 * flameScale};${24 * flameScale}" dur="2.4s" repeatCount="indefinite"/>
          </ellipse>
          <path d="M70 112 C 76 121, 79 126, 77 132 C 84 130, 82 142, 70 147 C 58 142, 56 130, 63 132 C 61 126, 64 121, 70 112 Z" fill="${T.flame}" opacity="0.92">
            <animate attributeName="opacity" values="0.85;1;0.85" dur="1.6s" repeatCount="indefinite"/>
          </path>
          <path d="M70 120 C 73 125, 74 128, 73 131 C 76 131, 76 137, 70 140 C 64 137, 64 131, 67 131 C 66 128, 67 125, 70 120 Z" fill="${T.amber}" opacity="0.95"/>
          ` : `<text x="70" y="136" text-anchor="middle" fill="${T.text1}" font-size="9">wygaszony</text>`}
          <text x="70" y="180" text-anchor="middle" fill="${burning ? T.flame : T.text1}" font-size="11" font-weight="700" font-family="ui-monospace,monospace">
            ${s.fire ? 'PŁOMIEŃ' : (s.boilerState === 'IGNITION' ? 'ROZPAL.' : `${s.fanPct}%`)}
          </text>

          ${hopper}

          <path d="M 120 95 H 230 V 50 H 320" fill="none" stroke="url(#piecPipeHot)" stroke-width="4" stroke-linecap="round"/>
          <path d="M 120 155 H 270 V 110 H 320" fill="none" stroke="url(#piecPipeRet)" stroke-width="4" stroke-linecap="round" stroke-dasharray="8,4"/>
          ${pumpCo ? [0, 0.33, 0.66].map(o => `<circle r="3" fill="${T.amber}"><animateMotion dur="2.8s" repeatCount="indefinite" begin="${(o * 2.8).toFixed(2)}s" path="M 120 95 H 230 V 50 H 320"/></circle>`).join('') : ''}
          <path d="M 200 95 V 175 H 320" fill="none" stroke="${T.water}" stroke-width="3" stroke-linecap="round" stroke-dasharray="5,4" opacity="0.7"/>

          <g transform="translate(320,30)">
            <rect width="32" height="44" rx="4" fill="${T.bg2}" stroke="${T.flame}88" stroke-width="1.2"/>
            ${[0, 1, 2, 3].map(i => `<line x1="${6 + i * 7}" y1="3" x2="${6 + i * 7}" y2="41" stroke="${T.flame}44" stroke-width="1.5"/>`).join('')}
            <text x="16" y="58" text-anchor="middle" fill="${T.text1}" font-size="9">CO</text>
            <text x="16" y="71" text-anchor="middle" fill="${T.flame}" font-size="11" font-weight="700" font-family="ui-monospace,monospace">${fmt(supply, 0)}°</text>
          </g>
          <g transform="translate(320,150)">
            <rect width="32" height="44" rx="16" fill="${T.bg2}" stroke="${T.water}88" stroke-width="1.2"/>
            <rect x="3" y="${3 + (1 - 0.7) * 38}" width="26" height="${Math.max(2, 0.7 * 38)}" rx="3" fill="${T.water}22"/>
            <circle cx="16" cy="22" r="3" fill="none" stroke="${T.water}" stroke-width="1.4"/>
            <text x="16" y="58" text-anchor="middle" fill="${T.text1}" font-size="9">CWU</text>
            <text x="16" y="71" text-anchor="middle" fill="${T.water}" font-size="11" font-weight="700" font-family="ui-monospace,monospace">${fmt(cwu, 0)}°</text>
          </g>

          <g transform="translate(232,93)">
            <circle r="9" fill="${T.bg0}" stroke="${pumpCo ? T.green : T.text1}" stroke-width="1.2">
              ${pumpCo ? `<animate attributeName="stroke-opacity" values="1;0.4;1" dur="1.4s" repeatCount="indefinite"/>` : ''}
            </circle>
            <text text-anchor="middle" y="3" fill="${pumpCo ? T.green : T.text1}" font-size="11" font-weight="700">P</text>
          </g>

          <text x="175" y="88" fill="${T.flame}" font-size="9" font-family="ui-monospace,monospace">${fmt(supply, 1)}°</text>
          <text x="175" y="148" fill="${T.indigoL}" font-size="9" font-family="ui-monospace,monospace">${fmt(ret, 1)}°</text>
          ${pressure != null ? this._svgManometer(pressure, 246, 134, 15) : ''}
        </svg>`;
    }

    _svgChimney(x, y, flue, working) {
      const W = 16, H = 60;
      const fc = flue == null ? T.text1 : (flue > 170 ? T.red : flue > 140 ? T.flame : T.amber);
      const smoke = working ? [0, 0.7, 1.4].map(delay => `
        <circle cx="${W / 2}" r="6" fill="url(#piecSmoke)">
          <animate attributeName="cy" values="-2;-28;-52" dur="2.1s" begin="${delay}s" repeatCount="indefinite"/>
          <animate attributeName="r" values="3;8;13" dur="2.1s" begin="${delay}s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0;0.7;0" dur="2.1s" begin="${delay}s" repeatCount="indefinite"/>
        </circle>`).join('') : '';
      return `<g transform="translate(${x},${y})">
        <defs>
          <linearGradient id="piecChimney" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#1F232C"/><stop offset="50%" stop-color="#2A2F3A"/><stop offset="100%" stop-color="#15181F"/></linearGradient>
          <radialGradient id="piecSmoke" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#9AA3B5" stop-opacity="0.55"/><stop offset="100%" stop-color="#9AA3B5" stop-opacity="0"/></radialGradient>
        </defs>
        ${smoke}
        <rect x="-3" y="0" width="${W + 6}" height="3.5" rx="1" fill="#2A2F3A" stroke="${T.border}" stroke-width="0.5"/>
        <rect x="0" y="3" width="${W}" height="${H}" rx="1" fill="url(#piecChimney)" stroke="${T.border}" stroke-width="0.6"/>
        <line x1="${W * 0.7}" y1="4" x2="${W * 0.7}" y2="${H + 2}" stroke="#0B0D12" stroke-width="0.6"/>
        ${working ? `<rect x="2" y="${H - 6}" width="${W - 4}" height="6" fill="${fc}" opacity="0.35"><animate attributeName="opacity" values="0.25;0.5;0.25" dur="1.8s" repeatCount="indefinite"/></rect>` : ''}
        <g transform="translate(${W},${H * 0.55})">
          <line x1="-6" y1="0" x2="0" y2="0" stroke="#5A6478" stroke-width="1.6"/>
          <rect x="0" y="-2.5" width="3.5" height="5" rx="0.6" fill="#3A4150" stroke="${T.border}" stroke-width="0.5"/>
          <path d="M 3.5 0 Q 10 0, 12 6" fill="none" stroke="#5A6478" stroke-width="1"/>
          <g transform="translate(12,6)">
            <rect x="0" y="-7" width="40" height="14" rx="3" fill="#0B0D12" fill-opacity="0.92" stroke="${fc}aa" stroke-width="0.7"/>
            <circle cx="6" cy="0" r="2" fill="none" stroke="${fc}" stroke-width="0.9"/>
            <line x1="6" y1="-1.5" x2="6" y2="-5" stroke="${fc}" stroke-width="0.9" stroke-linecap="round"/>
            <text x="12" y="3.5" fill="${fc}" font-size="10" font-weight="700" font-family="ui-monospace,monospace">${flue == null ? '—' : Math.round(flue) + '°'}</text>
          </g>
        </g>
        <text x="${W / 2}" y="${H + 12}" text-anchor="middle" fill="${T.text1}" font-size="8" letter-spacing="0.5">SPALINY</text>
      </g>`;
    }

    _svgManometer(value, x, y, R) {
      const startA = 135, endA = 45 + 360, total = endA - startA;
      const pct = Math.max(0, Math.min(1, value / 3));
      const valA = startA + total * pct;
      const pol = (a) => { const r = a * Math.PI / 180; return [x + R * Math.cos(r), y + R * Math.sin(r)]; };
      const arc = (a1, a2) => { const [x1, y1] = pol(a1), [x2, y2] = pol(a2); const large = a2 - a1 > 180 ? 1 : 0; return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
      const ok = value >= 1.3 && value <= 2.2;
      const accent = ok ? T.green : T.amber;
      const [nx, ny] = pol(valA);
      return `<g>
        <circle cx="${x}" cy="${y}" r="${R + 3}" fill="${T.bg2}" stroke="${T.border}" stroke-width="0.8"/>
        <circle cx="${x}" cy="${y}" r="${R}" fill="#0B0D12" stroke="${T.border}" stroke-width="0.5"/>
        <path d="${arc(startA, endA)}" fill="none" stroke="${T.bg3}" stroke-width="2.5"/>
        <path d="${arc(startA, valA)}" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>
        <path d="${arc(startA + total * (2.2 / 3), endA)}" fill="none" stroke="${T.red}" stroke-width="2.5" opacity="0.55"/>
        <line x1="${x}" y1="${y}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${accent}" stroke-width="1.4" stroke-linecap="round"/>
        <circle cx="${x}" cy="${y}" r="1.8" fill="${accent}"/>
        <text x="${x}" y="${y + R - 3}" text-anchor="middle" fill="${T.text0}" font-size="8" font-weight="700" font-family="ui-monospace,monospace">${value.toFixed(1)}</text>
        <text x="${x}" y="${y + R + 8}" text-anchor="middle" fill="${T.text1}" font-size="7" letter-spacing="0.5">BAR</text>
      </g>`;
    }

    _svgHopperAuger(tankPct, feederOn) {
      const fillH = (tankPct / 100) * 30;
      return `
        <defs>
          <linearGradient id="piecHopperBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3A4150"/><stop offset="100%" stop-color="${T.bg2}"/></linearGradient>
          <linearGradient id="piecPellets" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${T.amber}"/><stop offset="100%" stop-color="${T.flame}"/></linearGradient>
          <clipPath id="piecHopperInner"><path d="M 132 14 L 178 14 L 168 44 L 142 44 Z"/></clipPath>
          <clipPath id="piecAugerClip"><path d="M 142 49 L 168 49 L 78 102 L 62 102 Z"/></clipPath>
          <linearGradient id="piecAugerBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3A4150"/><stop offset="50%" stop-color="${T.bg3}"/><stop offset="100%" stop-color="#1A1D24"/></linearGradient>
        </defs>
        <path d="M 130 12 L 180 12 L 169 46 L 141 46 Z" fill="url(#piecHopperBody)" stroke="${T.border}" stroke-width="0.8" stroke-linejoin="round"/>
        <g clip-path="url(#piecHopperInner)"><rect x="130" y="${44 - fillH}" width="50" height="34" fill="url(#piecPellets)" opacity="0.92"/></g>
        <g transform="translate(155,30)">
          <rect x="-15" y="-7" width="30" height="14" rx="2.5" fill="#0B0D12" fill-opacity="0.82" stroke="${T.amber}66" stroke-width="0.6"/>
          <text x="0" y="3.5" text-anchor="middle" fill="${T.amber}" font-size="10" font-weight="700" font-family="ui-monospace,monospace">${Math.round(tankPct)}%</text>
        </g>
        <rect x="142" y="46" width="26" height="3" fill="${T.bg3}" stroke="${T.border}" stroke-width="0.5"/>
        <path d="M 142 49 L 168 49 L 78 102 L 62 102 Z" fill="url(#piecAugerBody)" stroke="${T.border}" stroke-width="0.8" stroke-linejoin="round"/>
        <g clip-path="url(#piecAugerClip)">
          <path d="M 150 48 L 70 102 M 158 48 L 78 102 M 166 48 L 86 102 M 174 48 L 94 102 M 182 48 L 102 102" stroke="${T.amber}" stroke-width="2.2" stroke-linecap="round" opacity="0.85">
            ${feederOn ? `<animateTransform attributeName="transform" type="translate" values="0 0; -8 5" dur="0.45s" repeatCount="indefinite"/>` : ''}
          </path>
        </g>
        <g transform="translate(170,48) rotate(33)">
          <rect x="-2" y="-6" width="14" height="12" rx="2" fill="${T.bg3}" stroke="${T.border}" stroke-width="0.7"/>
          <circle cx="-3" cy="0" r="1.8" fill="#3A4150" stroke="${T.border}" stroke-width="0.5"/>
          <circle cx="-3" cy="0" r="0.9" fill="${feederOn ? T.green : T.text1}">${feederOn ? `<animate attributeName="fill-opacity" values="1;0.3;1" dur="0.9s" repeatCount="indefinite"/>` : ''}</circle>
        </g>
        <ellipse cx="70" cy="102" rx="9" ry="2.4" fill="#0B0D12" stroke="${T.border}" stroke-width="0.6"/>
        ${feederOn ? [0, 0.2, 0.42, 0.64].map((delay, i) => `
        <circle r="${1.4 + (i % 2) * 0.4}" fill="${T.amber}">
          <animate attributeName="cy" values="100;108;115" dur="0.55s" begin="${delay}s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0;1;1;0" dur="0.55s" begin="${delay}s" repeatCount="indefinite"/>
        </circle>`).join('') : ''}
        <g transform="translate(120,82)">
          <rect x="-13" y="-7" width="26" height="13" rx="2.5" fill="${T.bg0}" fill-opacity="0.85" stroke="${T.amber}66" stroke-width="0.6"/>
          <text x="0" y="3" text-anchor="middle" fill="${T.amber}" font-size="9" font-weight="700" font-family="ui-monospace,monospace">${this.state.fanPct}%</text>
        </g>`;
    }

    /* ───────── suwak nastawy ───────── */

    _renderSetpoint() {
      const host = this._slot.setpoint; if (!host) return;
      const min = 40, max = 85;
      const val = this._targetPending != null ? this._targetPending : (this.state.nastaw == null ? 60 : Math.round(this.state.nastaw));
      const v = Math.max(min, Math.min(max, val));
      const pct = ((v - min) / (max - min)) * 100;
      const accent = T.flame;
      const label = this.settings.summer ? 'Nastaw CO · tryb letni' : 'Nastaw CO';
      host.innerHTML = `
        <div style="background:${T.bg2};border:1px solid ${T.border};border-radius:10px;padding:10px 12px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
            <span style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;">${esc(label)}</span>
            <span data-sp-val style="font-size:16px;color:${accent};font-weight:700;font-variant-numeric:tabular-nums;line-height:1;">${v}<span style="font-size:11px;color:${T.text1};font-weight:400;">°C</span></span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button type="button" class="iot-piec-ibtn" data-sp="dec">−</button>
            <div data-sp-track style="flex:1;position:relative;height:22px;cursor:pointer;touch-action:none;">
              <div style="position:absolute;left:0;right:0;top:50%;height:6px;margin-top:-3px;background:${T.bg0};border-radius:999px;border:1px solid ${T.border};"></div>
              <div data-sp-fill style="position:absolute;left:0;top:50%;height:6px;margin-top:-3px;width:${pct}%;background:linear-gradient(90deg,${T.indigo},${accent});border-radius:999px;box-shadow:0 0 8px ${accent}55;"></div>
              ${[50, 60, 70, 80].map(t => { const tp = ((t - min) / (max - min)) * 100; return `<div style="position:absolute;top:50%;margin-top:5px;left:${tp}%;transform:translateX(-50%);font-size:8px;color:${T.text1};font-variant-numeric:tabular-nums;">${t}</div>`; }).join('')}
              <div data-sp-thumb style="position:absolute;top:50%;left:${pct}%;transform:translate(-50%,-50%);width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid ${accent};box-shadow:0 0 0 3px ${accent}33,0 2px 4px rgba(0,0,0,.4);"></div>
            </div>
            <button type="button" class="iot-piec-ibtn" data-sp="inc">+</button>
          </div>
        </div>`;
      this._attachSetpoint(min, max);
    }

    // Lekka aktualizacja suwaka bez przebudowy DOM (bezpieczna w trakcie przeciągania).
    _updateSetpointVisual(min, max) {
      const host = this._slot.setpoint; if (!host) return;
      const v = Math.max(min, Math.min(max, this._targetPending == null ? 60 : this._targetPending));
      const pct = ((v - min) / (max - min)) * 100;
      const fill = host.querySelector('[data-sp-fill]');
      const thumb = host.querySelector('[data-sp-thumb]');
      const val = host.querySelector('[data-sp-val]');
      if (fill) fill.style.width = pct + '%';
      if (thumb) thumb.style.left = pct + '%';
      if (val) val.firstChild && (val.firstChild.textContent = String(v));
    }

    _attachSetpoint(min, max) {
      const host = this._slot.setpoint; if (!host) return;
      // stopPropagation na trwałym hoście — tylko raz (host nie jest odtwarzany przy _renderSetpoint).
      if (!this._spHostBound) {
        this._spHostBound = true;
        ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => host.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
      }
      const set = (v) => { this._targetPending = Math.max(min, Math.min(max, Math.round(v))); this._updateSetpointVisual(min, max); };
      host.querySelectorAll('[data-sp]').forEach(b => b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const cur = this._targetPending != null ? this._targetPending : (this.state.nastaw == null ? 60 : Math.round(this.state.nastaw));
        set(cur + (b.dataset.sp === 'inc' ? 1 : -1));
        this._publishNastaw();
      }));
      const track = host.querySelector('[data-sp-track]');
      if (track) {
        const fromX = (clientX) => {
          const r = track.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
          return min + ratio * (max - min);
        };
        track.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (!this.state.online) return;
          if (this._targetPending == null) this._targetPending = this.state.nastaw == null ? 60 : Math.round(this.state.nastaw);
          set(fromX(e.clientX));
          const move = (ev) => set(fromX(ev.clientX));
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            this._publishNastaw();
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
      }
    }

    _publishNastaw() {
      if (this._targetPending == null) return;
      const v = this._targetPending;
      clearTimeout(this._spTimer);
      this._spTimer = setTimeout(() => {
        this._pub('nastaw', String(v));
        this.state.nastaw = v;
        this._targetPending = null; // od teraz suwak śledzi state.nastaw (echo z FW)
        this._mark('chart');
      }, 250);
    }

    /* ───────── mini status (5 kafelków) ───────── */

    _renderMiniStatus() {
      const host = this._slot.ministatus; if (!host) return;
      const s = this.state;
      const ret = this._ret, flue = this._flue, zew = this._zew;
      const tiles = [
        { l: 'CO', v: ret == null ? '—' : `${fmt(ret, 0)}°`, c: T.indigoL, t: 'Temperatura obiegu CO' },
        { l: 'Spaliny', v: flue == null ? '—' : `${fmt(flue, 0)}°`, c: flue > 260 ? T.amber : T.flame, t: 'Temperatura spalin' },
        { l: 'Zewn.', v: zew == null ? '—' : `${fmt(zew, 1)}°`, c: T.water },
        { l: 'Dmuch.', v: `${s.fanPct}%`, c: T.indigoL },
        { l: 'Ciśn.', v: s.pressure == null ? '—' : fmt(s.pressure, 1), c: (s.pressure != null && (s.pressure < 1.3 || s.pressure > 2.2)) ? T.amber : T.green, t: 'Ciśnienie [bar]' },
      ];
      host.innerHTML = tiles.map(({ l, v, c, t }) => `
        <div title="${esc(t || l)}" style="background:${T.bg2};border-radius:8px;padding:6px 2px;text-align:center;border:1px solid ${T.border};">
          <div style="font-size:8px;color:${T.text1};text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px;">${esc(l)}</div>
          <div style="font-size:12px;font-weight:700;color:${c};font-variant-numeric:tabular-nums;">${esc(v)}</div>
        </div>`).join('');
    }

    /* ───────── wykres ───────── */

    _renderChart() {
      const host = this._slot.chart; if (!host) return;
      const legend = [
        { c: T.flame, l: 'Kocioł', dash: 'none' },
        { c: T.amber, l: 'CO', dash: '3,3' },
        { c: T.water, l: 'CWU', dash: '5,3' },
      ];
      host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;">Przebieg temperatur</span>
          <div style="display:flex;gap:10px;">
            ${legend.map(({ c, l, dash }) => `<div style="display:flex;align-items:center;gap:4px;"><svg width="12" height="3"><line x1="0" y1="1.5" x2="12" y2="1.5" stroke="${c}" stroke-width="2" stroke-dasharray="${dash}"/></svg><span style="font-size:9px;color:${T.text1};">${l}</span></div>`).join('')}
          </div>
        </div>
        <div style="height:80px;" data-chart-svg></div>`;
      this._drawChart(host.querySelector('[data-chart-svg]'));
    }

    _drawChart(mount) {
      if (!mount) return;
      const W = 320, H = 80, MIN = 0, MAX = 90;
      const view = this.history.slice(-this.viewCount);
      const toY = v => H - ((Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN)) * H;
      const n = view.length;
      const xAt = i => n <= 1 ? 0 : i * (W / (n - 1));
      const linePath = (key) => {
        const pts = [];
        view.forEach((p, i) => { if (p[key] != null && !isNaN(p[key])) pts.push([xAt(i), toY(p[key])]); });
        if (pts.length < 2) return '';
        let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
        for (let i = 1; i < pts.length; i++) {
          const [px, py] = pts[i - 1], [cx, cy] = pts[i], mx = (px + cx) / 2;
          d += ` C${mx.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`;
        }
        return d;
      };
      const nastaw = this._targetPending != null ? this._targetPending : this.state.nastaw;
      const grid = [30, 50, 70];
      mount.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="display:block;overflow:visible;">
          ${grid.map(v => `<line x1="0" y1="${toY(v)}" x2="${W}" y2="${toY(v)}" stroke="${T.border}" stroke-width="1"/>`).join('')}
          ${nastaw != null ? `<line x1="0" y1="${toY(nastaw)}" x2="${W}" y2="${toY(nastaw)}" stroke="${T.green}" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>` : ''}
          <path d="${linePath('piec')}" fill="none" stroke="${T.flame}" stroke-width="2" stroke-linejoin="round"/>
          <path d="${linePath('co')}" fill="none" stroke="${T.amber}" stroke-width="1.3" stroke-linejoin="round" stroke-dasharray="3,3" opacity="0.8"/>
          <path d="${linePath('cwu')}" fill="none" stroke="${T.water}" stroke-width="1.6" stroke-linejoin="round" stroke-dasharray="5,3"/>
          ${grid.map(v => `<text x="3" y="${toY(v) - 2}" fill="${T.text1}" font-size="8">${v}°</text>`).join('')}
          ${n === 0 ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${T.text1}" font-size="10">oczekiwanie na dane…</text>` : ''}
        </svg>`;
    }

    /* ───────── pasek paliwa ───────── */

    _renderFuelbar() {
      const host = this._slot.fuelbar; if (!host) return;
      const s = this.state;
      const pct = s.tankPct == null ? null : Math.max(0, Math.min(100, s.tankPct));
      const eta = s.etaStr && s.etaStr !== '—' ? s.etaStr : null;
      const right = pct == null ? '—' : `${fmt(pct, 0)}%${eta ? ` · ${esc(eta)}` : ''}`;
      const warn = pct != null && pct <= 15;
      host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <span style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;">Zasobnik paliwa</span>
          <span style="font-size:11px;color:${warn ? T.red : T.text0};font-weight:600;font-variant-numeric:tabular-nums;">${right}</span>
        </div>
        <div style="position:relative;height:14px;background:${T.bg0};border-radius:7px;overflow:hidden;border:1px solid ${T.border};">
          <div style="height:100%;width:${pct == null ? 0 : pct}%;background:linear-gradient(90deg,${T.amber},${T.flame});box-shadow:0 0 8px ${T.amber}55;"></div>
          ${[20, 40, 60, 80].map(p => `<div style="position:absolute;top:0;bottom:0;left:${p}%;width:1px;background:rgba(0,0,0,0.35);"></div>`).join('')}
        </div>`;
    }

    /* ───────── zużycie 7 dni ───────── */

    _dailyKey() { return 'iot:piecdaily:' + this._widgetId(); }
    _recordDaily() {
      if (this.state.kgToday == null) return;
      const now = new Date();
      const wk = this._isoWeek(now);
      const idx = (now.getDay() + 6) % 7; // Pn=0
      let store = { wk, days: [0, 0, 0, 0, 0, 0, 0] };
      try { const r = localStorage.getItem(this._dailyKey()); if (r) store = JSON.parse(r); } catch (_) {}
      if (store.wk !== wk) store = { wk, days: [0, 0, 0, 0, 0, 0, 0] };
      store.days[idx] = Math.round(this.state.kgToday * 100) / 100;
      try { localStorage.setItem(this._dailyKey(), JSON.stringify(store)); } catch (_) {}
      return store;
    }
    _isoWeek(d) {
      const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = (dt.getUTCDay() + 6) % 7;
      dt.setUTCDate(dt.getUTCDate() - day + 3);
      const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
      return dt.getUTCFullYear() + '-' + (1 + Math.round(((dt - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7));
    }

    _renderConsumption() {
      const host = this._slot.consumption; if (!host) return;
      const s = this.state;
      const cost = this.settings.costPerKg || 1.45;
      const store = this._recordDaily();
      const days = (store && store.days) || [0, 0, 0, 0, 0, 0, 0];
      const todayIdx = (new Date().getDay() + 6) % 7;
      const max = Math.max(1, ...days);
      const weekKg = s.kgWeek != null ? s.kgWeek : days.reduce((a, b) => a + b, 0);
      const W = 280, H = 78, BH = 40;
      const bars = days.map((v, i) => {
        const x = days.length <= 1 ? 0 : i * (W / (days.length - 1));
        const h = (v / max) * BH;
        const today = i === todayIdx;
        const c = (v * cost).toFixed(0);
        return `<g>
          <text x="${x}" y="9" text-anchor="middle" fill="${today ? T.amber : T.text1}" font-size="8" font-weight="${today ? '700' : '500'}" font-family="ui-monospace,monospace">${c}zł</text>
          <rect x="${x - 13}" y="${56 - h}" width="26" height="${h}" rx="3" fill="${today ? T.flame : T.bg3}"/>
          <text x="${x}" y="${54 - h - 1}" text-anchor="middle" fill="${today ? T.flame : T.text1}" font-size="8" font-weight="600" font-family="ui-monospace,monospace">${v ? v.toFixed(0) : ''}</text>
          <text x="${x}" y="70" text-anchor="middle" fill="${T.text1}" font-size="8">${DAYS[i]}</text>
        </g>`;
      }).join('');
      host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
          <span style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;">Zużycie · 7 dni</span>
          <span style="font-size:10px;color:${T.text1};">
            <span style="color:${T.text0};font-weight:600;font-variant-numeric:tabular-nums;">${fmt(weekKg, 0)} kg</span>
            <span style="margin:0 6px;">·</span>
            <span style="color:${T.amber};font-weight:600;font-variant-numeric:tabular-nums;">${(weekKg * cost).toFixed(0)} zł</span>
          </span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">${bars}</svg>
        <div style="margin-top:4px;display:flex;justify-content:space-around;font-size:9px;color:${T.text1};">
          <span><span style="color:${T.amber};">●</span> zł / dzień</span>
          <span><span style="color:${T.flame};">●</span> kg / dzień</span>
        </div>`;
    }

    /* ───────── akcje ───────── */

    _renderActions() {
      const host = this._slot.actions; if (!host) return;
      host.innerHTML = `
        <button type="button" data-act="refuel" style="flex:1;background:${T.indigo};color:#fff;border:0;border-radius:999px;padding:9px 0;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">+ Dorzuć paliwo</button>
        <button type="button" data-act="settings" style="flex:1;background:${T.bg2};color:${T.text0};border:1px solid ${T.border};border-radius:999px;padding:9px 0;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;"><span style="font-size:13px;">⚙</span> Ustawienia</button>`;
    }

    _attachActions() {
      const stop = (e) => e.stopPropagation();
      const actHost = this._slot.actions;
      if (actHost) {
        ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => actHost.addEventListener(ev, stop, { passive: true }));
        actHost.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]'); if (!btn) return;
          e.preventDefault(); e.stopPropagation();
          if (btn.dataset.act === 'refuel') this._openRefuel();
          else if (btn.dataset.act === 'settings') this._openSettings();
        });
      }
    }

    /* ───────── popover paliwa ───────── */

    _openRefuel() {
      if (!this.state.online) { alert('Urządzenie offline.'); return; }
      const def = this.state.avgLoad > 0 ? this.state.avgLoad : 5;
      this._modal('Dorzuć paliwo', `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
          ${[5, 10, 15, 20].map(kg => `<button type="button" class="cancel" data-kg="${kg}" style="border-radius:8px;padding:10px 0;font-weight:700;">${kg} kg</button>`).join('')}
        </div>
        <input type="number" data-v inputmode="decimal" step="0.5" min="0.1" value="${esc(String(def))}" placeholder="własna ilość">
        <div style="font-size:10px;color:${T.text1};text-align:center;">Zasobnik: ${this.state.tankPct == null ? '—' : fmt(this.state.tankPct, 0) + '%'}</div>
        <div class="row"><button class="cancel" data-x>Anuluj</button><button class="save" data-s>Dodaj</button></div>
      `, (panel, close) => {
        const input = panel.querySelector('[data-v]');
        panel.querySelectorAll('[data-kg]').forEach(b => b.addEventListener('click', () => {
          this._pub('fuel/manual_load', b.dataset.kg); close();
        }));
        panel.querySelector('[data-x]').addEventListener('click', close);
        panel.querySelector('[data-s]').addEventListener('click', () => {
          const v = parseFloat(input.value);
          if (isNaN(v) || v <= 0) { alert('Podaj dodatnią ilość.'); return; }
          this._pub('fuel/manual_load', String(v)); close();
        });
        setTimeout(() => { input.focus(); input.select(); }, 50);
      });
    }

    _modal(title, bodyHtml, onMount) {
      const bk = document.createElement('div');
      bk.className = 'iot-piec-modal-bk';
      bk.innerHTML = `<div class="iot-piec-modal" role="dialog" aria-label="${esc(title)}"><h4>${esc(title)}</h4>${bodyHtml}</div>`;
      document.body.appendChild(bk);
      const panel = bk.querySelector('.iot-piec-modal');
      const close = () => { bk.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => bk.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
      bk.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === bk) close(); });
      if (onMount) onMount(panel, close);
      return { panel, close };
    }

    /* ───────── panel ustawień (overlay) ───────── */

    _openSettings() {
      const host = this._slot.overlay; if (!host) return;
      host.dataset.open = '1';
      const S = this.settings;
      const offNz = Object.values(S.offsets).filter(v => v !== 0).length;
      host.innerHTML = `
        <div class="iot-piec-overlay">
          <div style="width:100%;background:${T.bg1};border:1px solid ${T.border};border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6);">
            <div style="padding:12px 14px;background:${T.bg0};border-bottom:1px solid ${T.border};display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:12px;font-weight:600;color:${T.text0};text-transform:uppercase;letter-spacing:.08em;">⚙ Ustawienia kotła</span>
              <button type="button" data-o="close" style="background:transparent;color:${T.text1};border:1px solid ${T.border};border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:14px;line-height:1;font-family:inherit;">✕</button>
            </div>
            <div style="flex:1;overflow-y:auto;padding:14px;" data-o="body">
              <div style="background:${T.bg2};border:1px solid ${S.summer ? T.water + '66' : T.border};border-radius:10px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;gap:12px;">
                <div style="width:36px;height:36px;border-radius:8px;background:${S.summer ? T.water + '22' : T.bg0};border:1px solid ${S.summer ? T.water + '66' : T.border};display:flex;align-items:center;justify-content:center;font-size:18px;color:${S.summer ? T.water : T.text1};">☀</div>
                <div style="flex:1;"><div style="font-size:12px;color:${T.text0};font-weight:600;margin-bottom:2px;">Tryb letni</div><div style="font-size:10px;color:${T.text1};">CO wyłączone, tylko podgrzew CWU</div></div>
                <div data-o="summer" style="width:40px;height:22px;border-radius:999px;background:${S.summer ? T.water : T.bg3};border:1px solid ${S.summer ? T.water : T.border};position:relative;cursor:pointer;flex:none;">
                  <div style="position:absolute;top:1px;left:${S.summer ? 19 : 1}px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .15s;"></div>
                </div>
              </div>

              <div style="background:${T.bg2};border:1px solid ${T.border};border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:12px;">
                <div style="width:36px;height:36px;border-radius:8px;background:${T.bg0};border:1px solid ${T.border};display:flex;align-items:center;justify-content:center;color:${T.amber};font-weight:700;font-size:13px;">zł</div>
                <div style="flex:1;"><div style="font-size:12px;color:${T.text0};font-weight:600;margin-bottom:2px;">Koszt paliwa</div><div style="font-size:10px;color:${T.text1};">używane do statystyk i wykresów</div></div>
                <input type="number" step="0.01" min="0" data-o="cost" value="${esc(String(S.costPerKg))}" style="width:72px;background:${T.bg0};color:${T.amber};border:1px solid ${T.border};border-radius:6px;padding:6px 8px;font-size:13px;font-weight:700;outline:none;text-align:right;font-variant-numeric:tabular-nums;">
                <span style="font-size:10px;color:${T.text1};">zł/kg</span>
              </div>

              ${this._sectionHtml('curve', '📈', T.flame, 'Krzywa grzewcza', `${S.curve.length} pkt · ${S.curve[0] ? S.curve[0].supply : '?'}°…${S.curve[S.curve.length - 1] ? S.curve[S.curve.length - 1].supply : '?'}°`, S.summer)}
              ${this._sectionHtml('offsets', '🎯', T.indigoL, 'Kalibracja czujników', offNz === 0 ? 'wszystkie 0.0°' : `${offNz} z offsetem`, false)}

              <div style="background:${T.bg2};border:1px solid ${T.border};border-radius:10px;padding:12px 14px;${S.summer ? 'opacity:.4;pointer-events:none;' : ''}" data-o="sched-wrap">
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
                  <span style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;">Harmonogramy · ${S.schedules.filter(x => x.active).length} aktywne</span>
                  <button type="button" data-o="sched-add" style="background:transparent;color:${T.indigoL};border:1px solid ${T.indigo}66;border-radius:6px;padding:4px 10px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:.05em;text-transform:uppercase;">+ Dodaj</button>
                </div>
                <div data-o="sched-list">${this._schedulesHtml()}</div>
              </div>
            </div>
            <div style="padding:10px 14px;background:${T.bg0};border-top:1px solid ${T.border};display:flex;justify-content:flex-end;gap:8px;">
              <button type="button" data-o="done" style="background:${T.indigo};color:#fff;border:0;border-radius:999px;padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Gotowe</button>
            </div>
          </div>
        </div>`;
      this._attachSettings();
    }

    _closeSettings() {
      const host = this._slot.overlay; if (!host) return;
      host.dataset.open = '0';
      host.innerHTML = '';
      this._renderHeader(); this._renderStatusbar(); this._renderSetpoint();
      this._renderMiniStatus(); this._renderConsumption(); this._schemSig = null; this._renderSchematic();
    }

    _sectionHtml(id, icon, color, title, subtitle, disabled) {
      const open = this._openSection === id;
      return `
        <div data-sec="${id}" style="background:${T.bg2};border:1px solid ${open ? color + '66' : T.border};border-radius:10px;margin-bottom:12px;overflow:hidden;${disabled ? 'opacity:.4;pointer-events:none;' : ''}">
          <div data-o="sec-toggle" data-id="${id}" style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;">
            <div style="width:32px;height:32px;border-radius:8px;background:${T.bg0};border:1px solid ${T.border};display:flex;align-items:center;justify-content:center;font-size:16px;color:${color};">${icon}</div>
            <div style="flex:1;min-width:0;"><div style="font-size:12px;color:${T.text0};font-weight:600;">${esc(title)}</div><div style="font-size:10px;color:${T.text1};margin-top:2px;">${esc(subtitle)}</div></div>
            <span style="font-size:14px;color:${T.text1};${open ? 'transform:rotate(180deg);' : ''}">⌄</span>
          </div>
          ${open ? `<div style="padding:4px 14px 14px;border-top:1px solid ${T.border};background:${T.bg1};" data-o="sec-body" data-id="${id}">${id === 'curve' ? this._curveHtml() : this._offsetsHtml()}</div>` : ''}
        </div>`;
    }

    _curveHtml() {
      const W = 320, H = 140, PAD = { l: 28, r: 12, t: 10, b: 24 };
      const xMin = -20, xMax = 20, yMin = 30, yMax = 80;
      const toX = v => PAD.l + ((v - xMin) / (xMax - xMin)) * (W - PAD.l - PAD.r);
      const toY = v => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
      const curve = this.settings.curve;
      const path = curve.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.outside).toFixed(1)} ${toY(p.supply).toFixed(1)}`).join(' ');
      return `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <span style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;">Zasil. vs zewn.</span>
          <span style="font-size:10px;color:${T.text1};">przeciągnij punkty</span>
        </div>
        <div style="background:${T.bg0};border:1px solid ${T.border};border-radius:8px;padding:4px;">
          <svg data-o="curve-svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;touch-action:none;">
            ${[40, 50, 60, 70, 80].map(v => `<g><line x1="${PAD.l}" y1="${toY(v)}" x2="${W - PAD.r}" y2="${toY(v)}" stroke="${T.border}" stroke-width="0.5"/><text x="${PAD.l - 4}" y="${toY(v) + 3}" text-anchor="end" fill="${T.text1}" font-size="8" font-family="ui-monospace,monospace">${v}°</text></g>`).join('')}
            ${[-20, -10, 0, 10, 20].map(v => `<g><line x1="${toX(v)}" y1="${PAD.t}" x2="${toX(v)}" y2="${H - PAD.b}" stroke="${T.border}" stroke-width="0.5"/><text x="${toX(v)}" y="${H - PAD.b + 10}" text-anchor="middle" fill="${T.text1}" font-size="8" font-family="ui-monospace,monospace">${v > 0 ? '+' + v : v}</text></g>`).join('')}
            <line x1="${toX(0)}" y1="${PAD.t}" x2="${toX(0)}" y2="${H - PAD.b}" stroke="${T.water}" stroke-width="0.8" stroke-dasharray="2,2" opacity="0.5"/>
            <path d="${path} L ${toX(xMax)} ${H - PAD.b} L ${toX(xMin)} ${H - PAD.b} Z" fill="${T.flame}" fill-opacity="0.08"/>
            <path d="${path}" fill="none" stroke="${T.flame}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            ${curve.map((p, i) => `<g data-cp="${i}" style="cursor:ns-resize;"><circle cx="${toX(p.outside)}" cy="${toY(p.supply)}" r="9" fill="transparent"/><circle cx="${toX(p.outside)}" cy="${toY(p.supply)}" r="5" fill="${T.bg0}" stroke="${T.flame}" stroke-width="2"/><text x="${toX(p.outside)}" y="${toY(p.supply) - 9}" text-anchor="middle" fill="${T.flame}" font-size="9" font-weight="700" font-family="ui-monospace,monospace">${p.supply}°</text></g>`).join('')}
          </svg>
        </div>`;
    }

    _offsetsHtml() {
      const sensors = [
        { key: 'supply', label: 'Zasilanie CO', color: T.flame },
        { key: 'ret', label: 'Obieg CO', color: T.amber },
        { key: 'cwu', label: 'CWU', color: T.water },
        { key: 'outside', label: 'Zewnętrzny', color: T.indigoL },
        { key: 'flue', label: 'Spaliny', color: T.red },
      ];
      const o = this.settings.offsets;
      return `
        <div style="font-size:10px;color:${T.text1};margin:8px 0;line-height:1.4;">Kompensacja błędu wskazań. Offset doliczany do odczytu.</div>
        ${sensors.map(({ key, label, color }) => {
          const off = o[key], sign = off > 0 ? '+' : '';
          return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid ${T.border};">
            <span style="width:7px;height:7px;border-radius:50%;background:${color};flex:none;"></span>
            <span style="flex:1;font-size:12px;color:${T.text0};">${esc(label)}</span>
            <button type="button" class="iot-piec-ibtn" data-off="${key}" data-d="-0.1">−</button>
            <span style="min-width:56px;text-align:center;font-size:13px;font-weight:700;color:${off === 0 ? T.text1 : color};font-variant-numeric:tabular-nums;">${sign}${off.toFixed(1)}°</span>
            <button type="button" class="iot-piec-ibtn" data-off="${key}" data-d="0.1">+</button>
            ${off !== 0 ? `<button type="button" data-off-reset="${key}" style="background:transparent;color:${T.text1};border:1px solid ${T.border};border-radius:6px;padding:3px 7px;font-size:9px;cursor:pointer;font-family:inherit;">reset</button>` : ''}
          </div>`;
        }).join('')}`;
    }

    _schedulesHtml() {
      return this.settings.schedules.map((sc, i) => {
        const exp = this._expandedSched === sc.id;
        return `<div style="background:${T.bg0};border:1px solid ${exp ? T.flame + '66' : T.border};border-radius:10px;margin-bottom:8px;overflow:hidden;">
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;" data-o="sched-exp" data-id="${sc.id}">
            <div data-o="sched-toggle" data-i="${i}" style="width:30px;height:18px;border-radius:999px;background:${sc.active ? T.green : T.bg3};border:1px solid ${sc.active ? T.green : T.border};position:relative;cursor:pointer;flex:none;">
              <div style="position:absolute;top:1px;left:${sc.active ? 13 : 1}px;width:14px;height:14px;border-radius:50%;background:#fff;"></div>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;color:${sc.active ? T.text0 : T.text1};font-weight:600;margin-bottom:2px;">${esc(sc.name)}</div>
              <div style="font-size:10px;color:${T.text1};font-variant-numeric:tabular-nums;display:flex;gap:8px;align-items:center;">
                <span>${esc(sc.from)}–${esc(sc.to)}</span><span>·</span>
                <span style="color:${sc.active ? T.flame : T.text1};font-weight:600;">${sc.temp}°C</span><span>·</span>
                <span>${sc.days.map((on, j) => on ? DAYS[j] : '·').join(' ')}</span>
              </div>
            </div>
            <span style="font-size:14px;color:${T.text1};${exp ? 'transform:rotate(180deg);' : ''}">⌄</span>
          </div>
          ${exp ? this._scheduleEditHtml(sc, i) : ''}
        </div>`;
      }).join('');
    }

    _scheduleEditHtml(sc, i) {
      const lbl = `display:block;font-size:9px;color:${T.text1};text-transform:uppercase;letter-spacing:.06em;margin-top:8px;margin-bottom:4px;`;
      const inp = `width:100%;background:${T.bg0};color:${T.text0};border:1px solid ${T.border};border-radius:6px;padding:6px 8px;font-size:12px;font-family:inherit;outline:none;box-sizing:border-box;`;
      return `<div style="padding:4px 12px 12px;border-top:1px solid ${T.border};background:${T.bg1};">
        <label style="${lbl}">Nazwa</label>
        <input data-o="sc-name" data-i="${i}" value="${esc(sc.name)}" style="${inp}">
        <label style="${lbl}">Dni</label>
        <div style="display:flex;gap:4px;margin-bottom:10px;">
          ${DAYS.map((d, j) => `<button type="button" data-o="sc-day" data-i="${i}" data-j="${j}" style="flex:1;height:28px;border-radius:6px;background:${sc.days[j] ? T.flame + '22' : T.bg0};color:${sc.days[j] ? T.flame : T.text1};border:1px solid ${sc.days[j] ? T.flame + '88' : T.border};font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;">${d}</button>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><label style="${lbl}">Od</label><input type="time" data-o="sc-from" data-i="${i}" value="${esc(sc.from)}" style="${inp}"></div>
          <div><label style="${lbl}">Do</label><input type="time" data-o="sc-to" data-i="${i}" value="${esc(sc.to)}" style="${inp}"></div>
        </div>
        <label style="${lbl}">Temperatura zasilania</label>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <button type="button" class="iot-piec-ibtn" data-o="sc-temp" data-i="${i}" data-d="-1">−</button>
          <div style="flex:1;text-align:center;font-size:16px;font-weight:700;color:${T.flame};font-variant-numeric:tabular-nums;">${sc.temp}<span style="font-size:11px;color:${T.text1};font-weight:400;">°C</span></div>
          <button type="button" class="iot-piec-ibtn" data-o="sc-temp" data-i="${i}" data-d="1">+</button>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px;">
          <button type="button" data-o="sc-del" data-i="${i}" style="background:transparent;color:${T.red};border:1px solid ${T.red}55;border-radius:6px;padding:5px 10px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:.05em;text-transform:uppercase;">Usuń harmonogram</button>
        </div>
      </div>`;
    }

    _attachSettings() {
      const host = this._slot.overlay; if (!host) return;
      const stop = (e) => e.stopPropagation();
      ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => host.addEventListener(ev, stop, { passive: true }));
      const refreshSections = () => { this._openSettings(); };
      const refreshScheds = () => {
        const list = host.querySelector('[data-o="sched-list"]');
        if (list) { list.innerHTML = this._schedulesHtml(); this._bindScheduleEls(); }
      };

      host.querySelector('[data-o="close"]').addEventListener('click', () => this._closeSettings());
      host.querySelector('[data-o="done"]').addEventListener('click', () => this._closeSettings());

      const summer = host.querySelector('[data-o="summer"]');
      if (summer) summer.addEventListener('click', () => {
        this.settings.summer = !this.settings.summer;
        this._saveSettings();
        this._pub('tryb_letni', this.settings.summer ? 'ON' : 'OFF');
        refreshSections();
      });

      const cost = host.querySelector('[data-o="cost"]');
      if (cost) cost.addEventListener('change', () => {
        const v = Math.max(0, num(cost.value, this.settings.costPerKg));
        this.settings.costPerKg = v; this._saveSettings();
        this._pub('fuel/cost_pln', String(v));
      });

      host.querySelectorAll('[data-o="sec-toggle"]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.id;
        this._openSection = this._openSection === id ? null : id;
        refreshSections();
      }));

      this._bindCurve();
      this._bindOffsets(refreshSections);
      this._bindScheduleEls();

      host.querySelector('[data-o="sched-add"]')?.addEventListener('click', () => {
        const next = { id: 'sc_' + Date.now(), name: 'Nowy harmonogram', active: true, days: [true, true, true, true, true, false, false], from: '06:00', to: '22:00', temp: 65 };
        this.settings.schedules.push(next); this._expandedSched = next.id; this._saveSettings();
        refreshScheds();
      });
    }

    _bindCurve() {
      const svg = this._slot.overlay.querySelector('[data-o="curve-svg"]');
      if (!svg) return;
      const H = 140, PAD = { t: 10, b: 24 }, yMin = 30, yMax = 80;
      const fromY = (py) => { const ratio = 1 - (py - PAD.t) / (H - PAD.t - PAD.b); return Math.round(Math.max(yMin, Math.min(yMax, yMin + ratio * (yMax - yMin)))); };
      svg.querySelectorAll('[data-cp]').forEach(g => {
        g.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          const idx = +g.dataset.cp;
          const move = (ev) => {
            const pt = svg.createSVGPoint();
            pt.x = ev.clientX; pt.y = ev.clientY;
            const sp = pt.matrixTransform(svg.getScreenCTM().inverse());
            this.settings.curve[idx].supply = fromY(sp.y);
            // odśwież tylko SVG krzywej
            const body = this._slot.overlay.querySelector('[data-o="sec-body"][data-id="curve"]');
            if (body) { body.innerHTML = this._curveHtml(); this._bindCurve(); }
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            this._saveSettings();
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
      });
    }

    _bindOffsets(refresh) {
      const host = this._slot.overlay;
      host.querySelectorAll('[data-off]').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.off, d = num(b.dataset.d, 0);
        this.settings.offsets[k] = Math.round((this.settings.offsets[k] + d) * 10) / 10;
        this._saveSettings();
        const body = host.querySelector('[data-o="sec-body"][data-id="offsets"]');
        if (body) { body.innerHTML = this._offsetsHtml(); this._bindOffsets(refresh); }
      }));
      host.querySelectorAll('[data-off-reset]').forEach(b => b.addEventListener('click', () => {
        this.settings.offsets[b.dataset.offReset] = 0; this._saveSettings();
        const body = host.querySelector('[data-o="sec-body"][data-id="offsets"]');
        if (body) { body.innerHTML = this._offsetsHtml(); this._bindOffsets(refresh); }
      }));
    }

    _bindScheduleEls() {
      const host = this._slot.overlay;
      const save = () => this._saveSettings();
      const refreshList = () => { const l = host.querySelector('[data-o="sched-list"]'); if (l) { l.innerHTML = this._schedulesHtml(); this._bindScheduleEls(); } };
      host.querySelectorAll('[data-o="sched-exp"]').forEach(r => r.addEventListener('click', (e) => {
        if (e.target.closest('[data-o="sched-toggle"]')) return;
        const id = r.dataset.id;
        this._expandedSched = this._expandedSched === id ? null : id;
        refreshList();
      }));
      host.querySelectorAll('[data-o="sched-toggle"]').forEach(t => t.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = +t.dataset.i; this.settings.schedules[i].active = !this.settings.schedules[i].active; save(); refreshList();
      }));
      host.querySelectorAll('[data-o="sc-name"]').forEach(inp => inp.addEventListener('input', () => { this.settings.schedules[+inp.dataset.i].name = inp.value; save(); }));
      host.querySelectorAll('[data-o="sc-from"]').forEach(inp => inp.addEventListener('change', () => { this.settings.schedules[+inp.dataset.i].from = inp.value; save(); refreshList(); }));
      host.querySelectorAll('[data-o="sc-to"]').forEach(inp => inp.addEventListener('change', () => { this.settings.schedules[+inp.dataset.i].to = inp.value; save(); refreshList(); }));
      host.querySelectorAll('[data-o="sc-day"]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.i, j = +b.dataset.j; this.settings.schedules[i].days[j] = !this.settings.schedules[i].days[j]; save(); refreshList(); }));
      host.querySelectorAll('[data-o="sc-temp"]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.i, d = num(b.dataset.d, 0); const sc = this.settings.schedules[i]; sc.temp = Math.max(40, Math.min(80, sc.temp + d)); save(); refreshList(); }));
      host.querySelectorAll('[data-o="sc-del"]').forEach(b => b.addEventListener('click', () => { this.settings.schedules.splice(+b.dataset.i, 1); save(); refreshList(); }));
    }

    /* ───────── publikacja komend ───────── */

    _pub(sub, payload) {
      const sse = this.ctx && this.ctx.sse;
      const sn = this.ctx && this.ctx.sn;
      if (!sse || !sn) { return; }
      try { sse.publish(`${sn}/cmd/${sub}`, String(payload), sn); }
      catch (e) { try { console.warn('[piec] publish failed', sub, e); } catch (_) {} }
    }

    /* ───────── subskrypcje MQTT ───────── */

    _subscribe() {
      const sse = this.ctx.sse, sn = this.ctx.sn;
      if (!sse || !sn) return;
      const cache = (window.__iotPiecCache = window.__iotPiecCache || new Map());
      const S = this.state;
      const map = {
        rssi:        p => { S.rssi = num(p, null); },
        t_piec:      p => { S.tPiec = num(p, null); this._pushHistory(); this._mark('schematic'); this._mark('chart'); },
        t_co:        p => { S.tCo = num(p, null); this._pushHistory(); this._mark('schematic'); this._mark('chart'); this._mark('ministatus'); },
        t_cwu:       p => { S.tCwu = num(p, null); this._pushHistory(); this._mark('schematic'); this._mark('chart'); },
        t_zew:       p => { S.tZew = num(p, null); this._mark('ministatus'); },
        t_spaliny:   p => { S.tSpaliny = /null/i.test(String(p)) ? null : num(p, null); this._mark('schematic'); this._mark('ministatus'); },
        fire:        p => { S.fire = bool(p); this._mark('schematic'); },
        fan_pct:     p => { S.fanPct = Math.max(0, Math.min(100, num(p, 0) | 0)); this._mark('schematic'); this._mark('ministatus'); },
        relay_co:    p => { S.pumpCo = bool(p); this._mark('schematic'); },
        relay_cwu:   p => { S.pumpCwu = bool(p); },
        state:       p => { S.boilerState = String(p ?? '').trim().toUpperCase(); this._mark('statusbar'); this._mark('schematic'); },
        mode:        p => { S.mode = String(p ?? '').trim().toUpperCase(); this._mark('header'); },
        nastaw:      p => { const v = num(p, null); if (v != null) { S.nastaw = v; if (this._targetPending == null) { this._mark('setpoint'); this._mark('chart'); } } },
        safety:      p => { S.safety = bool(p); },
        tryb_letni:  p => { const v = bool(p); if (this.settings.summer !== v) { this.settings.summer = v; this._saveSettings(); this._mark('header'); this._mark('setpoint'); } },
        pressure:    p => { S.pressure = /null/i.test(String(p)) ? null : num(p, null); this._mark('schematic'); this._mark('ministatus'); },
        feeder:      p => { S.hasFeeder = bool(p); this._mark('schematic'); },
        feeder_act:  p => { S.feederActive = bool(p); this._mark('schematic'); },
        tank_pct:    p => { S.tankPct = num(p, null); this._mark('schematic'); this._mark('fuelbar'); },
        eta_str:     p => { S.etaStr = String(p ?? '').trim(); this._mark('fuelbar'); },
        cost_per_kg: p => { const v = num(p, null); if (v != null) { this.settings.costPerKg = v; this._saveSettings(); this._mark('consumption'); } },
        avg_load:    p => { S.avgLoad = num(p, 5); },
        kg_today:    p => { S.kgToday = num(p, null); this._mark('consumption'); },
        pln_today:   p => { S.plnToday = num(p, null); this._mark('consumption'); },
        kg_week:     p => { S.kgWeek = num(p, null); this._mark('consumption'); },
        alarm_count: p => { S.alarmCount = num(p, 0) | 0; },
        alarms:      p => { S.alarms = this._parseAlarms(p); this._mark('statusbar'); },
      };
      Object.entries(map).forEach(([key, handler]) => {
        const suf = (this.cfg[key + '_topic_suffix'] || '').trim();
        if (!suf) return;
        const topic = sn + '/' + suf;
        sse.on(topic, (p) => cache.set(topic, p));
        sse.on(topic, handler);
        const cached = cache.get(topic);
        if (cached !== undefined && cached !== null) { try { handler(cached); } catch (_) {} }
      });

      const statusTopic = sn + '/status';
      const statusHandler = (p) => {
        const v = String(p ?? '').trim().toLowerCase();
        const isOnline = (v === 'online' || v === '1');
        if (S.online === isOnline) return;
        S.online = isOnline;
        this._renderAll();
      };
      sse.on(statusTopic, (p) => cache.set(statusTopic, p));
      sse.on(statusTopic, statusHandler);
      const cs = cache.get(statusTopic);
      if (cs !== undefined && cs !== null) { try { statusHandler(cs); } catch (_) {} }
    }

    _parseAlarms(p) {
      const raw = String(p ?? '').trim();
      if (!raw || raw === '[]') return [];
      try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.map(String) : []; }
      catch (_) { return raw.replace(/[[\]"]/g, '').split(',').map(s => s.trim()).filter(Boolean); }
    }

    /* ───────── historia (IndexedDB) ───────── */

    _widgetId() {
      const id = this.cfg && this.cfg.id;
      const sn = (this.ctx && this.ctx.sn) ? String(this.ctx.sn) : '';
      if (!id) {
        this._fallbackId = this._fallbackId || ('piec_nostore_' + Math.random().toString(36).slice(2, 10));
        return sn ? (sn + ':' + this._fallbackId) : this._fallbackId;
      }
      return sn ? (sn + ':' + id) : id;
    }

    _pushHistory() {
      const piec = this._supply, co = this._ret, cwu = this._cwu;
      if (piec == null && co == null && cwu == null) return;
      const t = Date.now();
      if (this._lastSample && t - this._lastSample < 1500) {
        const last = this.history[this.history.length - 1];
        if (last) { last.piec = piec; last.co = co; last.cwu = cwu; }
        return;
      }
      this._lastSample = t;
      this.history.push({ t, piec, co, cwu });
      while (this.history.length > this.MEM_CAP) this.history.shift();
      if (window.IoTHistoryDB) {
        const wid = this._widgetId(), sn = (this.ctx && this.ctx.sn) || '';
        if (piec != null && !isNaN(piec)) window.IoTHistoryDB.push(wid, 0, sn, t, piec);
        if (co != null && !isNaN(co))     window.IoTHistoryDB.push(wid, 1, sn, t, co);
        if (cwu != null && !isNaN(cwu))   window.IoTHistoryDB.push(wid, 2, sn, t, cwu);
      }
    }

    async _hydrateFromDB() {
      if (!window.IoTHistoryDB) return;
      const wid = this._widgetId();
      try {
        const [a, b, c] = await Promise.all([
          window.IoTHistoryDB.read(wid, 0), window.IoTHistoryDB.read(wid, 1), window.IoTHistoryDB.read(wid, 2),
        ]);
        const byT = new Map();
        const put = (arr, key) => (Array.isArray(arr) ? arr : []).forEach(s => {
          const t = s.t | 0; if (!t) return;
          const o = byT.get(t) || { t }; o[key] = parseFloat(s.v); byT.set(t, o);
        });
        put(a, 'piec'); put(b, 'co'); put(c, 'cwu');
        const merged = [...byT.values()].sort((x, y) => x.t - y.t);
        if (merged.length) { this.history = merged.concat(this.history).slice(-this.MEM_CAP); this._renderChart(); }
      } catch (_) {}
    }
  }

  window.IoTWidgets = window.IoTWidgets || {};
  window.IoTWidgets['piec'] = PiecWidget;
})();
