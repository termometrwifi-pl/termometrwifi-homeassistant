(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Tokeny czytają wartości CSS variables z :root przy każdym dostępie, dzięki czemu
  // przełącznik motywu (data-iot-theme=light/dark) wpływa na inline style przy re-renderze.
  // Fallback hex = wartość dark (zgodne z dotychczasowym zachowaniem przy braku CSS).
  const T = new Proxy({
    bg0:    ['--iot-bg',     '#0F1115'],
    bg1:    ['--iot-bg-2',   '#14171F'],
    bg2:    ['--iot-card',   '#1A1D24'],
    bg3:    ['--iot-card-2', '#232730'],
    border: ['--iot-border', '#2A2F3A'],
    text0:  ['--iot-text',   '#14171F'],
    text1:  ['--iot-text-dim','#5C6478'],
    indigo: ['--iot-accent', '#6366F1'],
    indigoL:['--iot-accent-2','#818CF8'],
    green:  ['--iot-success','#10B981'],
    amber:  ['--iot-warn',   '#F59E0B'],
    red:    ['--iot-danger', '#EF4444'],
  }, {
    get(target, prop) {
      const entry = target[prop];
      if (!entry) return undefined;
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(entry[0]).trim();
        return v || entry[1];
      } catch (e) { return entry[1]; }
    }
  });

  // Domyślne fazy zgodne z enum aktualnieX firmware wedzarnia (1_0_2 .. 2_0_0; /PUB/AKTUAL = (int)aktualnie):
  // 0=RECZNIE (manual — pasek faz schowany), 1=OCIEKANIE, 2=ROZGRZEWANIE, 3=OSUSZANIE,
  // 4=ROZPALANIE, 5=WEDZENIE, 6=KONTROLA(unused), 7=PIECZENIE, 8=GOTOWE→Koniec, 9=PLUS(+30, transient).
  // Indeksy 0 i 6 są ukryte podczas renderowania paska (filter `hidden:true`).
  const DEFAULT_PHASES = [
    { label: 'Manual',       color: '#8A92A6', hidden: true },
    { label: 'Ociekanie',    color: '#6366F1' },
    { label: 'Rozgrzewanie', color: '#F59E0B' },
    { label: 'Osuszanie',    color: '#F59E0B' },
    { label: 'Rozpalanie',   color: '#EF4444' },
    { label: 'Wędzenie',     color: '#10B981' },
    { label: '—',            color: '#2A2F3A', hidden: true },
    { label: 'Pieczenie',    color: '#818CF8' },
    { label: 'Koniec',       color: '#10B981' },
  ];

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function num(p, fallback) {
    const v = parseFloat(p);
    return isNaN(v) ? fallback : v;
  }

  function bool(p) {
    if (p === true || p === 1) return true;
    const s = String(p ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'on' || parseFloat(s) > 0;
  }

  // Lista dostępnych programów (publikowane na program_sub_topic_suffix po kliknięciu w MANUAL).
  const PROGRAM_OPTIONS = ['MANUAL', 'SZYNKA', 'KIELBASA', 'KRAKOWSKA', 'RYBA', 'WLASNY', 'PRZEPIS'];

  // Parametry programu własnego — 4 czasy faz (min) + 5 progów temperatury (°C).
  // Każdy parametr ma topic PUB (firmware publikuje aktualną wartość — my subskrybujemy)
  // i topic SUB (firmware subskrybuje — my publikujemy gdy user zmienia w modalu).
  const PROG_PARAMS = [
    { key: 'dripping',  label: 'Ociekanie',          unit: 'min', step: 1,  pubKey: 'prog_dripping_pub_topic_suffix',  subKey: 'prog_dripping_sub_topic_suffix' },
    { key: 'drying',    label: 'Osuszanie',          unit: 'min', step: 1,  pubKey: 'prog_drying_pub_topic_suffix',    subKey: 'prog_drying_sub_topic_suffix' },
    { key: 'smoking',   label: 'Wędzenie',           unit: 'min', step: 1,  pubKey: 'prog_smoking_pub_topic_suffix',   subKey: 'prog_smoking_sub_topic_suffix' },
    { key: 'baking',    label: 'Pieczenie',          unit: 'min', step: 1,  pubKey: 'prog_baking_pub_topic_suffix',    subKey: 'prog_baking_sub_topic_suffix' },
    { key: 'heatTemp',  label: 'Temp. rozgrzewania', unit: '°C', step: 0.1, pubKey: 'prog_heat_temp_pub_topic_suffix', subKey: 'prog_heat_temp_sub_topic_suffix' },
    { key: 'dryTemp',   label: 'Temp. suszenia',     unit: '°C', step: 0.1, pubKey: 'prog_dry_temp_pub_topic_suffix',  subKey: 'prog_dry_temp_sub_topic_suffix' },
    { key: 'smokeTemp', label: 'Temp. wędzenia',     unit: '°C', step: 0.1, pubKey: 'prog_smoke_temp_pub_topic_suffix',subKey: 'prog_smoke_temp_sub_topic_suffix' },
    { key: 'bakeTemp',  label: 'Temp. pieczenia',    unit: '°C', step: 0.1, pubKey: 'prog_bake_temp_pub_topic_suffix', subKey: 'prog_bake_temp_sub_topic_suffix' },
    { key: 'meatMax',   label: 'Temp. wsadu max',    unit: '°C', step: 0.1, pubKey: 'prog_meat_max_pub_topic_suffix',  subKey: 'prog_meat_max_sub_topic_suffix' },
  ];

  function injectSmokerCss() {
    if (document.getElementById('iot-smoker-css')) return;
    const style = document.createElement('style');
    style.id = 'iot-smoker-css';
    style.textContent = `
      .iot-sm-fs-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.65); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; }
      .iot-sm-fs-panel { width:100%; max-width:1100px; max-height:90vh; background:var(--iot-bg-2); border:1px solid var(--iot-border); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px; box-shadow:0 20px 60px rgba(0,0,0,.45); }
      .iot-sm-fs-head { display:flex; justify-content:space-between; align-items:center; gap:10px; padding-bottom:10px; border-bottom:1px solid var(--iot-border); flex-wrap:wrap; }
      .iot-sm-fs-head button { width:32px; height:32px; padding:0; border:1px solid var(--iot-border); background:var(--iot-bg); color:var(--iot-text); border-radius:6px; cursor:pointer; font-size:14px; line-height:1; display:inline-flex; align-items:center; justify-content:center; }
      .iot-sm-fs-head button:hover { background:var(--iot-card); border-color:var(--iot-accent); }
      .iot-sm-fs-chart { flex:1; min-height:300px; height:60vh; position:relative; }
      .iot-sm-fs-chart svg { width:100%; height:100%; }
      .iot-sm-fs-crosshair { position:absolute; top:0; bottom:0; width:1px; background:var(--iot-text); opacity:0.4; pointer-events:none; }
      .iot-sm-fs-tooltip { position:absolute; background:var(--iot-bg); border:1px solid var(--iot-border); color:var(--iot-text); border-radius:6px; padding:6px 10px; pointer-events:none; box-shadow:0 4px 12px rgba(0,0,0,.4); white-space:nowrap; z-index:5; }
      .iot-sm-fs-timeline { position:relative; height:24px; margin-top:4px; }
      .iot-sm-prog-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.65); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; }
      .iot-sm-prog-panel { width:100%; max-width:480px; max-height:90vh; overflow:auto; background:var(--iot-bg-2); border:1px solid var(--iot-border); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px; box-shadow:0 20px 60px rgba(0,0,0,.45); }
      .iot-sm-prog-head { display:flex; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid var(--iot-border); }
      .iot-sm-prog-title { font-size:13px; font-weight:700; color:var(--iot-text); text-transform:uppercase; letter-spacing:.06em; }
      .iot-sm-prog-row { display:grid; grid-template-columns:1fr 130px; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid var(--iot-border); }
      .iot-sm-prog-row:last-child { border-bottom:none; }
      .iot-sm-prog-row label { font-size:12px; color:var(--iot-text); }
      .iot-sm-prog-row .unit { font-size:10px; color:var(--iot-text-dim); margin-left:4px; }
      .iot-sm-prog-row input { width:100%; padding:6px 8px; background:var(--iot-bg); color:var(--iot-text); border:1px solid var(--iot-border); border-radius:6px; font-size:13px; font-family:inherit; box-sizing:border-box; font-variant-numeric:tabular-nums; }
      .iot-sm-prog-row input:focus { outline:none; border-color:var(--iot-accent); box-shadow:0 0 0 2px rgba(99,102,241,0.2); }
      .iot-sm-prog-row .live { font-size:10px; color:var(--iot-text-dim); }
      .iot-sm-prog-foot { display:flex; gap:8px; padding-top:10px; border-top:1px solid var(--iot-border); }
      .iot-sm-prog-foot button { flex:1; padding:9px; border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
      .iot-sm-prog-foot .save { background:var(--iot-success); color:#fff; }
      .iot-sm-prog-foot .save:hover { filter:brightness(1.1); }
      .iot-sm-prog-foot .cancel { background:var(--iot-card-2); color:var(--iot-text); }
      .iot-sm-prog-foot .cancel:hover { background:var(--iot-border); }
    `;
    document.head.appendChild(style);
  }

  function formatTime(mins) {
    if (mins == null || isNaN(mins)) return '—';
    const h = Math.floor(mins / 60);
    const m = Math.floor(mins % 60);
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  }

  class SmokerWidget {
    constructor(cfg, ctx) {
      this.cfg = cfg || {};
      this.ctx = ctx || {};
      this.el = null;

      // Domyślne topiki sterowania zgodne z firmware wedzarnia (działa bez konfiguracji admina).
      // PUB/CTRL = tryb (TRIAC/ONOFF); SUB/* = komendy. Admin może nadpisać w edytorze kategorii.
      const cd = (k, def) => { if (!this.cfg[k]) this.cfg[k] = def; };
      cd('ctrl_topic_suffix',      'PUB/CTRL');
      cd('fan1_sub_topic_suffix',  'SUB/FAN1');
      cd('fan2_sub_topic_suffix',  'SUB/FAN2');
      cd('dym_sub_topic_suffix',   'SUB/DYM');
      cd('light_sub_topic_suffix', 'SUB/LED');
      cd('stat_sub_topic_suffix',  'SUB/STAT');
      // Nastawy po kliknięciu w kafelek/czas: cel temp komory(dym) i wsadu + czas (MANUAL).
      cd('tdm_sub_topic_suffix',   'SUB/TDM');   // cel temperatury komory/dym (klik w kafelek KOMORA/DYM)
      cd('twm_sub_topic_suffix',   'SUB/TWM');   // cel temperatury wsadu (klik w kafelek SONDA/WSAD)
      cd('czas_sub_topic_suffix',  'SUB/Czas');  // ustawienie czasu HH:MM (klik w czas — tylko PROG=MANUAL)

      // Blokada STOP (kłódka) — gdy program pracuje, STOP jest domyślnie zablokowany,
      // żeby przypadkowy klik nie zatrzymał cyklu. User odblokowuje kłódką.
      this._runLocked = true;

      const phases = Array.isArray(this.cfg.phases) && this.cfg.phases.length
        ? this.cfg.phases : DEFAULT_PHASES;

      this.state = {
        chamberTemp: null,
        meatTemp: null,
        // Cele i całkowity czas — wartości tylko z MQTT, brak fallbacku (0 gdy nie nadeszło).
        targetChamber: 0,
        targetMeat: 0,
        elapsedMinutes: 0,
        totalMinutes: 0,
        currentPhase: 0,
        heaterOn: false,
        fan1On: false,
        fan2On: false,
        dymOn: false,
        lightOn: false,
        // Aktualne % mocy (TRIAC) — z PUB/FAN1,FAN2,DYM (0-100).
        fan1Pct: 0,
        fan2Pct: 0,
        dymPct: 0,
        // Tryb sterowania zgłaszany przez firmware (PUB/CTRL): 'TRIAC' (suwak) lub 'ONOFF' (toggle).
        ctrlMode: 'ONOFF',
        wifiRssi: null,
        programName: '',
        recipeName: '',
        statName: '',
        czasString: '',
        // online: stan presence z {sn}/status (LWT retain). Domyślnie true — gdy brak topiku status,
        // widget zachowuje się tak samo jak wcześniej (nie wymuszamy "offline" bez sygnału).
        online: true,
        // Parametry programu własnego — wartości z PUB topików (null = nie odebrano).
        programParams: PROG_PARAMS.reduce((acc, p) => { acc[p.key] = null; return acc; }, {}),
        phases,
      };

      this.timeDivisor = this.cfg.time_unit_seconds ? 60 : 1;
      // history: lista próbek {t, chamber, meat} — synchronizowana po timestampie.
      // Trzymana w pamięci do MEM_CAP, persistowana do IndexedDB osobno per logIdx (0=chamber, 1=meat).
      this.history = [];
      this.MEM_CAP = 10000;
      // Viewport: ile ostatnich próbek widać (count) i od którego indeksu (start).
      // follow=true → viewport zawsze przesuwa się do końca (live mode); pan w lewo wyłącza follow.
      const defaultCount = Math.max(10, num(this.cfg.history_size, 60) | 0);
      this.viewport = { start: 0, count: defaultCount, follow: true, defaultCount };
    }

    _applyContainerStyle() {
      const accent = this.cfg.accent_color || T.green;
      // Pojedyncze właściwości — żeby nie nadpisywać gridColumn/gridRow ustawianego przez iot-dashboard.js
      // po mount() (linie 2640-2641: ustawianie pozycji w siatce).
      const s = this.el.style;
      s.width = '100%';
      // Bez maxWidth — widget wypełnia grid cell, żeby drag w trybie edit chwytał całą szerokość.
      s.maxWidth = '';
      s.background = T.bg1;
      s.border = `1px solid ${T.border}`;
      s.borderTop = `3px solid ${accent}`;
      s.borderRadius = '14px';
      // Treść (z kontrolkami) bywa wyższa niż komórka siatki — różnie na różnych telefonach
      // (S25 vs Pixel, standalone vs przeglądarka). Zamiast przycinać (overflow:hidden), pozwalamy
      // scrollować pionowo w obrębie karty, żeby zawsze dało się dojechać do dolnych kontrolek.
      s.overflowX = 'hidden';
      s.overflowY = 'auto';
      s.webkitOverflowScrolling = 'touch';
      s.color = T.text0;
      s.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      s.boxShadow = `0 0 0 1px ${accent}22, 0 8px 32px rgba(0,0,0,.35)`;
    }

    // Wywoływane przez globalny listener iot:theme-change w widget-base.js.
    // Pełny re-render: HTML, sloty, wartości. Nie odpalamy ponownie _subscribe()
    // (już ma listenery SSE) ani _hydrateFromDB (dane są w state).
    render() {
      if (!this.el) return;
      this._applyContainerStyle();
      this.el.innerHTML = this._tpl();
      try { this._cacheRefs(); } catch (e) {}
      try { this._renderAll(); } catch (e) {}
      try { this._attachPanZoom(); } catch (e) {}
      try { this._attachProgramEdit(); } catch (e) {}
    }

    mount(parent) {
      injectSmokerCss();
      this.el = document.createElement('div');
      this.el.className = 'iot-widget iot-widget--smoker' + (this.cfg.bare ? ' iot-widget--bare' : '');
      this._applyContainerStyle();
      this.el.innerHTML = this._tpl();
      parent.appendChild(this.el);

      this._cacheRefs();
      this._renderAll();
      this._subscribe();
      this._hydrateFromDB();
      this._attachPanZoom();
      this._attachProgramEdit();
      this._attachSetpointEdit();

      if (window.IoTBaseWidget && window.IoTBaseWidget._instances) {
        window.IoTBaseWidget._instances.add(this);
      }
    }

    _attachProgramEdit() {
      const btn = this._slot.progEdit;
      if (!btn) return;
      const stop = (e) => e.stopPropagation();
      btn.addEventListener('mousedown', stop);
      btn.addEventListener('touchstart', stop, { passive: true });
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        this._openProgramEditor();
      });
    }

    /** Klik w kafelek (cel KOMORA→SUB/TDM, SONDA→SUB/TWM) i w czas (HH:MM→SUB/Czas, tylko MANUAL). */
    _attachSetpointEdit() {
      const stop = (e) => e.stopPropagation();
      const tilesHost = this._slot.tiles;
      if (tilesHost) {
        // stopPropagation tylko gdy klikamy edytowalny kafelek — nie blokujemy drag całego widgetu.
        ['mousedown', 'touchstart', 'pointerdown'].forEach(ev =>
          tilesHost.addEventListener(ev, (e) => { if (e.target.closest('[data-edit]')) stop(e); }, { passive: true }));
        tilesHost.addEventListener('click', (e) => {
          const tile = e.target.closest('[data-edit]');
          if (!tile) return;
          e.preventDefault(); e.stopPropagation();
          const which = tile.getAttribute('data-edit');
          const unit = this.cfg.unit || '°C';
          if (which === 'chamber') {
            this._openValueEdit({
              title: `Cel ${this.cfg.chamber_label || 'KOMORA'}`, inputType: 'number',
              value: this.state.targetChamber || '', unit, step: 0.1, min: 0, max: 300,
              onSave: (v) => { this._pubCmd(this.cfg.tdm_sub_topic_suffix, v.toFixed(2)); this.state.targetChamber = v; this._renderTiles(); this._renderChart(); },
            });
          } else if (which === 'meat') {
            this._openValueEdit({
              title: `Cel ${this.cfg.meat_label || 'SONDA'}`, inputType: 'number',
              value: this.state.targetMeat || '', unit, step: 0.1, min: 0, max: 300,
              onSave: (v) => { this._pubCmd(this.cfg.twm_sub_topic_suffix, v.toFixed(2)); this.state.targetMeat = v; this._renderTiles(); this._renderChart(); },
            });
          }
        });
      }
      const elEl = this._slot.elapsed;
      if (elEl) {
        ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => elEl.addEventListener(ev, stop, { passive: true }));
        elEl.style.cursor = 'pointer';
        elEl.setAttribute('title', 'Kliknij, aby ustawić czas (tylko w trybie MANUAL)');
        elEl.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (!this.state.online) return;
          if ((this.state.programName || '').toUpperCase() !== 'MANUAL') {
            alert('Czas można ustawić tylko w trybie MANUAL.');
            return;
          }
          // Wartość startowa HH:MM z bieżącego czasu (czasString lub elapsedMinutes).
          let cur = '';
          const cs = String(this.state.czasString || '').trim();
          const mHM = cs.match(/^(\d{1,2}):(\d{2})/);
          if (mHM) cur = `${String(+mHM[1]).padStart(2, '0')}:${mHM[2]}`;
          else if (this.state.elapsedMinutes > 0) {
            const tot = Math.round(this.state.elapsedMinutes);
            cur = `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
          }
          this._openValueEdit({
            title: 'Ustaw czas', inputType: 'time', value: cur,
            onSave: (v) => { this._pubCmd(this.cfg.czas_sub_topic_suffix, v); },
          });
        });
      }
    }

    /** Modal nastawy: inputType 'number' (unit/step/min/max) lub 'time' (HH:MM 24h). onSave(value). */
    _openValueEdit({ title, inputType, value, unit, step, min, max, onSave }) {
      const existing = document.body.querySelector('.iot-sm-prog-backdrop');
      if (existing) existing.remove();
      const backdrop = document.createElement('div');
      backdrop.className = 'iot-sm-prog-backdrop';
      const inputHtml = inputType === 'time'
        ? `<input type="time" data-vedit value="${esc(String(value || ''))}" step="60" style="font-size:18px;text-align:center;">`
        : `<input type="number" data-vedit value="${esc(String(value || ''))}" step="${step || 0.1}"${min != null ? ` min="${min}"` : ''}${max != null ? ` max="${max}"` : ''} inputmode="decimal" style="font-size:18px;text-align:center;">`;
      backdrop.innerHTML = `
        <div class="iot-sm-prog-panel" role="dialog" aria-label="${esc(title)}" style="max-width:300px;">
          <div class="iot-sm-prog-head">
            <span class="iot-sm-prog-title">${esc(title)}</span>
            <button type="button" class="cancel" style="background:transparent;color:#EF4444;border:none;cursor:pointer;font-size:18px;padding:0;width:28px;height:28px;line-height:1;">×</button>
          </div>
          <div class="iot-sm-prog-row" style="grid-template-columns:1fr;border-bottom:none;">
            ${inputHtml}
            ${unit ? `<div class="unit" style="text-align:center;">${esc(unit)}</div>` : ''}
          </div>
          <div class="iot-sm-prog-foot">
            <button type="button" class="cancel">Anuluj</button>
            <button type="button" class="save">Zapisz</button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);
      const panel = backdrop.querySelector('.iot-sm-prog-panel');
      const input = panel.querySelector('[data-vedit]');
      const close = () => { backdrop.remove(); document.removeEventListener('keydown', escHandler); };
      const escHandler = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', escHandler);
      ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => backdrop.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
      backdrop.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === backdrop) close(); });
      panel.querySelectorAll('button.cancel').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); close(); }));
      const doSave = () => {
        if (!this.ctx.sn || !this.ctx.sse) { alert('Brak połączenia MQTT (sn/sse). Spróbuj odświeżyć stronę.'); return; }
        const raw = String(input.value || '').trim();
        if (inputType === 'time') {
          const m = raw.match(/^(\d{1,2}):(\d{2})$/);
          if (!m || +m[1] > 23 || +m[2] > 59) { alert('Podaj czas w formacie HH:MM (24h).'); return; }
          onSave(`${String(+m[1]).padStart(2, '0')}:${m[2]}`);
        } else {
          const v = parseFloat(raw.replace(',', '.'));
          if (!Number.isFinite(v)) { alert('Podaj liczbę.'); return; }
          onSave(v);
        }
        close();
      };
      panel.querySelector('button.save').addEventListener('click', (e) => { e.stopPropagation(); doSave(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
      setTimeout(() => { try { input.focus(); if (inputType !== 'time') input.select(); } catch (_) {} }, 30);
    }

    _openProgramEditor() {
      const existing = document.body.querySelector('.iot-sm-prog-backdrop');
      if (existing) existing.remove();
      const backdrop = document.createElement('div');
      backdrop.className = 'iot-sm-prog-backdrop';
      const rows = PROG_PARAMS.map((p) => {
        const cur = this.state.programParams[p.key];
        const valStr = (cur != null) ? (Number.isInteger(p.step) ? Math.round(cur) : cur) : '';
        const liveStr = (cur != null) ? `${Number.isInteger(p.step) ? Math.round(cur) : cur.toFixed(1)} ${p.unit}` : '—';
        return `<div class="iot-sm-prog-row">
          <label><span>${esc(p.label)}</span><span class="unit">[${esc(p.unit)}]</span><div class="live">akt: ${esc(liveStr)}</div></label>
          <input type="number" data-pk="${p.key}" value="${valStr}" step="${p.step}" inputmode="decimal">
        </div>`;
      }).join('');
      backdrop.innerHTML = `
        <div class="iot-sm-prog-panel" role="dialog" aria-label="Program własny">
          <div class="iot-sm-prog-head">
            <span class="iot-sm-prog-title">Program własny</span>
            <button type="button" class="cancel" style="background:transparent;color:#EF4444;border:none;cursor:pointer;font-size:18px;padding:0;width:28px;height:28px;line-height:1;">×</button>
          </div>
          ${rows}
          <div class="iot-sm-prog-foot">
            <button type="button" class="cancel">Anuluj</button>
            <button type="button" class="save">Zapisz</button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);
      const panel = backdrop.querySelector('.iot-sm-prog-panel');
      const close = () => { backdrop.remove(); document.removeEventListener('keydown', escHandler); };
      const escHandler = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', escHandler);
      // Stop propagation – żeby dashboard drag nie chwytał.
      ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => {
        backdrop.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      });
      backdrop.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === backdrop) close(); });
      panel.querySelectorAll('button.cancel').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); close(); }));
      panel.querySelector('button.save').addEventListener('click', async (e) => {
        e.stopPropagation();
        const saveBtn = e.currentTarget;
        if (!this.ctx.sn || !this.ctx.sse) {
          alert('Brak połączenia MQTT (sn/sse). Spróbuj odświeżyć stronę.');
          return;
        }
        const tasks = [];
        const missing = [];
        PROG_PARAMS.forEach((p) => {
          const inp = panel.querySelector(`[data-pk="${p.key}"]`);
          if (!inp) return;
          const raw = inp.value.trim();
          if (raw === '') return; // puste pole = nie wysyłaj
          const v = parseFloat(raw);
          if (isNaN(v)) return;
          const subSuf = (this.cfg[p.subKey] || '').trim();
          if (!subSuf) {
            missing.push(p.label);
            return;
          }
          const topic = this.ctx.sn + '/' + subSuf;
          // Czasy publikujemy jako int (min), temperatury z 1 miejscem dziesiętnym.
          const payload = Number.isInteger(p.step) ? String(Math.round(v)) : String(v);
          tasks.push({ p, topic, payload });
        });
        if (!tasks.length) {
          if (missing.length) alert('Admin nie skonfigurował SUB topiku dla:\n' + missing.join('\n') + '\n\nDodaj suffix w panelu admina (kategoria → modul smoker).');
          else alert('Wypełnij przynajmniej jedno pole.');
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Wysyłanie…';
        const errors = [];
        let sessionExpired = false;
        for (const t of tasks) {
          if (sessionExpired) break;
          try {
            await this.ctx.sse.publish(t.topic, t.payload, this.ctx.sn);
          } catch (err) {
            if (err && (err.code === 'session_expired' || err.code === 'rest_cookie_invalid_nonce')) {
              sessionExpired = true;
              break;
            }
            const msg = (err && (err.error || err.message)) || JSON.stringify(err);
            errors.push(`${t.p.label} (${t.topic}): ${msg}`);
            try { console.warn('[smoker] publish prog failed', t.topic, err); } catch (_) {}
          }
        }
        if (sessionExpired) {
          // Korzystamy z helpera dashboardu (rozróżnia PWA JWT vs WP cookie).
          if (typeof window.iotShowSessionExpired === 'function') {
            window.iotShowSessionExpired();
          } else if (!/wp-login\.php/i.test(location.pathname)) {
            const cleanRedirect = location.origin + location.pathname + location.search.replace(/[?&]redirect_to=[^&]*/gi, '');
            location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(cleanRedirect);
          }
          return;
        }
        if (missing.length) errors.unshift('Brak SUB topiku dla: ' + missing.join(', '));
        if (errors.length) {
          alert('Błędy wysyłki:\n\n' + errors.join('\n'));
          saveBtn.disabled = false;
          saveBtn.textContent = 'Zapisz';
        } else {
          saveBtn.textContent = '✓ Wysłano';
          setTimeout(close, 800);
        }
      });
    }

    _openProgramSelect() {
      const subSuf = (this.cfg.program_sub_topic_suffix || '').trim();
      if (!this.ctx.sn || !this.ctx.sse) {
        alert('Brak połączenia MQTT. Spróbuj odświeżyć stronę.');
        return;
      }
      if (!subSuf) {
        alert('Admin nie skonfigurował SUB topiku dla programu (program_sub_topic_suffix).');
        return;
      }
      const existing = document.body.querySelector('.iot-sm-prog-backdrop');
      if (existing) existing.remove();
      const current = (this.state.programName || '').toUpperCase();
      const backdrop = document.createElement('div');
      backdrop.className = 'iot-sm-prog-backdrop';
      const rows = PROGRAM_OPTIONS.map((name) => {
        const active = name === current;
        return `<button type="button" data-prog="${esc(name)}" style="display:block;width:100%;padding:10px 12px;margin-bottom:6px;border:1px solid ${active ? T.green : T.border};background:${active ? T.green + '22' : T.bg0};color:${T.text0};border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;text-align:left;letter-spacing:.05em;text-transform:uppercase;">${esc(name)}</button>`;
      }).join('');
      backdrop.innerHTML = `
        <div class="iot-sm-prog-panel" role="dialog" aria-label="Wybór programu" style="max-width:360px;">
          <div class="iot-sm-prog-head">
            <span class="iot-sm-prog-title">Wybór programu</span>
            <button type="button" class="cancel" style="background:transparent;color:#EF4444;border:none;cursor:pointer;font-size:18px;padding:0;width:28px;height:28px;line-height:1;">×</button>
          </div>
          <div data-prog-list>${rows}</div>
        </div>
      `;
      document.body.appendChild(backdrop);
      const panel = backdrop.querySelector('.iot-sm-prog-panel');
      const close = () => { backdrop.remove(); document.removeEventListener('keydown', escHandler); };
      const escHandler = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', escHandler);
      ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => {
        backdrop.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      });
      backdrop.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === backdrop) close(); });
      panel.querySelector('button.cancel').addEventListener('click', (e) => { e.stopPropagation(); close(); });
      panel.querySelectorAll('[data-prog]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const name = btn.dataset.prog;
          const topic = this.ctx.sn + '/' + subSuf;
          panel.querySelectorAll('[data-prog]').forEach(b => b.disabled = true);
          btn.textContent = btn.textContent + ' …';
          try {
            await this.ctx.sse.publish(topic, name, this.ctx.sn);
            btn.textContent = name + ' ✓';
            setTimeout(close, 600);
          } catch (err) {
            if (err && (err.code === 'session_expired' || err.code === 'rest_cookie_invalid_nonce')) {
              if (typeof window.iotShowSessionExpired === 'function') {
                window.iotShowSessionExpired();
              } else if (!/wp-login\.php/i.test(location.pathname)) {
                const cleanRedirect = location.origin + location.pathname + location.search.replace(/[?&]redirect_to=[^&]*/gi, '');
                location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(cleanRedirect);
              }
              return;
            }
            const msg = (err && (err.error || err.message)) || JSON.stringify(err);
            alert('Błąd publikacji: ' + msg);
            panel.querySelectorAll('[data-prog]').forEach(b => b.disabled = false);
            btn.textContent = name;
          }
        });
      });
    }

    _widgetId() {
      const id = this.cfg && this.cfg.id;
      const sn = (this.ctx && this.ctx.sn) ? String(this.ctx.sn) : '';
      if (!id) {
        this._fallbackId = this._fallbackId || ('smoker_nostore_' + Math.random().toString(36).slice(2, 10));
        return sn ? (sn + ':' + this._fallbackId) : this._fallbackId;
      }
      return sn ? (sn + ':' + id) : id;
    }

    /** Ładuje historię z IndexedDB i odbudowuje this.history (chamber+meat sync po t). */
    async _hydrateFromDB() {
      if (!window.IoTHistoryDB) return;
      const wid = this._widgetId();
      try {
        const [c, m] = await Promise.all([
          window.IoTHistoryDB.read(wid, 0),
          window.IoTHistoryDB.read(wid, 1),
        ]);
        const cArr = Array.isArray(c) ? c : [];
        const mArr = Array.isArray(m) ? m : [];
        // Merge po t: budujemy mapę t→{chamber, meat}, sortujemy po t.
        const byT = new Map();
        cArr.forEach(p => { if (p && p.t != null) byT.set(p.t, Object.assign(byT.get(p.t) || {}, { t: p.t, chamber: p.v })); });
        mArr.forEach(p => { if (p && p.t != null) byT.set(p.t, Object.assign(byT.get(p.t) || {}, { t: p.t, meat: p.v })); });
        const merged = Array.from(byT.values()).sort((a, b) => a.t - b.t);
        // Cap pamięci — bierzemy ostatnie N.
        const capped = merged.length > this.MEM_CAP ? merged.slice(-this.MEM_CAP) : merged;
        this.history = capped;
        // Po hydrate ustawiamy viewport na koniec (follow mode).
        if (this.viewport.follow) {
          this.viewport.start = Math.max(0, this.history.length - this.viewport.count);
        }
        this._renderChart();
      } catch (e) {}
    }

    _tpl() {
      const accent = this.cfg.accent_color || T.green;
      const deviceName = this.cfg.label || this.cfg.device_name || (this.ctx.sn || 'Wędzarnia');
      return `
        <div class="sm-head" style="padding:10px 14px;background:${T.bg0};display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <span data-slot="offline" style="display:none;font-size:10px;font-weight:700;color:${T.red};background:${T.red}22;padding:2px 6px;border-radius:3px;letter-spacing:.08em;text-transform:uppercase;flex-shrink:0;">OFFLINE</span>
            <span style="font-size:11px;font-weight:600;color:${T.text0};text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(deviceName)}</span>
            <span data-slot="program" style="font-size:10px;font-weight:600;color:${accent};text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" hidden></span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span data-slot="wifi" style="display:inline-flex;align-items:center;height:14px;" title="WiFi"></span>
            <span data-slot="elapsed" style="font-size:10px;color:${accent};font-weight:600;font-variant-numeric:tabular-nums;">—</span>
          </div>
        </div>
        <div style="padding:14px;">
          <div data-slot="tiles" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;"></div>
          <div style="background:${T.bg0};border-radius:10px;padding:10px 12px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;">Przebieg temperatury</span>
              <div style="display:flex;gap:10px;">
                <div style="display:flex;align-items:center;gap:4px;">
                  <svg width="12" height="3"><line x1="0" y1="1.5" x2="12" y2="1.5" stroke="${accent}" stroke-width="2"/></svg>
                  <span style="font-size:9px;color:${T.text1};">${esc(this.cfg.chamber_label || 'Komora')}</span>
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                  <svg width="12" height="3"><line x1="0" y1="1.5" x2="12" y2="1.5" stroke="${T.amber}" stroke-width="2" stroke-dasharray="4,3"/></svg>
                  <span style="font-size:9px;color:${T.text1};">${esc(this.cfg.meat_label || 'Mięso')}</span>
                </div>
              </div>
            </div>
            <div data-slot="chart" style="height:clamp(70px,16vh,200px);"></div>
            <div data-slot="chart-toolbar" style="display:flex;gap:2px;justify-content:flex-end;margin-top:8px;"></div>
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
              <div style="flex:1;height:6px;background:${T.bg3};border-radius:999px;overflow:hidden;">
                <div data-slot="progress" style="height:100%;width:0%;background:linear-gradient(90deg,${T.indigo},${accent});border-radius:999px;transition:width .6s ease;box-shadow:0 0 8px ${T.indigo}55;"></div>
              </div>
              <span data-slot="time" style="font-size:11px;color:${T.text0};font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;">— / —</span>
            </div>
          </div>
          <div data-slot="chips" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;"></div>
          <div data-slot="controls" style="margin-top:10px;"></div>
        </div>
      `;
    }

    _cacheRefs() {
      const q = (s) => this.el.querySelector(`[data-slot="${s}"]`);
      this._slot = {
        wifi: q('wifi'),
        offline: q('offline'),
        elapsed: q('elapsed'),
        progEdit: q('prog-edit'),
        chartToolbar: q('chart-toolbar'),
        program: q('program'),
        programName: q('program-name'),
        tiles: q('tiles'),
        chart: q('chart'),
        phases: q('phases'),
        run: q('run'),
        progress: q('progress'),
        time: q('time'),
        chips: q('chips'),
        controls: q('controls'),
      };
    }

    _subscribe() {
      const sse = this.ctx.sse;
      const sn = this.ctx.sn;
      if (!sse || !sn) return;
      // Globalny cache ostatniego payloadu per pełny topic (przeżywa F5/re-mount widgetu w tej samej sesji).
      // Klucz = "{sn}/{suffix}", wartość = ostatni payload string.
      const cache = (window.__iotSmokerCache = window.__iotSmokerCache || new Map());
      const map = [
        ['chamber_temp_topic_suffix',    (p) => this._onChamber(p)],
        ['meat_temp_topic_suffix',       (p) => this._onMeat(p)],
        ['target_chamber_topic_suffix',  (p) => { const v = num(p, null); if (v != null) { this.state.targetChamber = v; this._renderTiles(); this._renderChart(); } }],
        ['target_meat_topic_suffix',     (p) => { const v = num(p, null); if (v != null) { this.state.targetMeat = v; this._renderTiles(); this._renderChart(); } }],
        ['elapsed_topic_suffix',         (p) => { const v = num(p, null); if (v != null) { this.state.elapsedMinutes = v / this.timeDivisor; this._renderHeader(); this._renderProgress(); } }],
        ['total_topic_suffix',           (p) => { const v = num(p, null); if (v != null) { this.state.totalMinutes = v / this.timeDivisor; this._renderProgress(); } }],
        ['phase_topic_suffix',           (p) => { const v = num(p, null); if (v != null) { this.state.currentPhase = v | 0; this._renderPhases(); this._renderChips(); } }],
        ['heater_topic_suffix',          (p) => { this.state.heaterOn = bool(p); this._renderChips(); }],
        ['fan1_topic_suffix',            (p) => { const v = num(p, 0); this.state.fan1Pct = Math.max(0, Math.min(100, v | 0)); this.state.fan1On = v > 0; if (v > 0 && v < 100) this.state.ctrlMode = 'TRIAC'; this._renderChips(); this._renderControls(); }],
        ['fan2_topic_suffix',            (p) => { const v = num(p, 0); this.state.fan2Pct = Math.max(0, Math.min(100, v | 0)); this.state.fan2On = v > 0; if (v > 0 && v < 100) this.state.ctrlMode = 'TRIAC'; this._renderChips(); this._renderControls(); }],
        ['dym_topic_suffix',             (p) => { const v = num(p, 0); this.state.dymPct = Math.max(0, Math.min(100, v | 0)); this.state.dymOn = v > 0; if (v > 0 && v < 100) this.state.ctrlMode = 'TRIAC'; this._renderChips(); this._renderControls(); }],
        ['light_topic_suffix',           (p) => { this.state.lightOn = bool(p); this._renderChips(); this._renderControls(); }],
        ['ctrl_topic_suffix',            (p) => { this.state.ctrlMode = /triac/i.test(String(p ?? '')) ? 'TRIAC' : 'ONOFF'; this._renderControls(); }],
        ['program_topic_suffix',         (p) => { this.state.programName = String(p ?? '').trim(); this._renderHeader(); this._renderPhases(); }],
        ['recipe_topic_suffix',          (p) => { this.state.recipeName = String(p ?? '').trim(); this._renderHeader(); }],
        ['stat_topic_suffix',            (p) => { this.state.statName = String(p ?? '').trim().toUpperCase(); this._renderPhases(); this._renderControls(); }],
        ['czas_topic_suffix',            (p) => {
          // Firmware naprzemiennie publikuje czas i marker presence "online"/"offline" na tym samym topiku.
          // Ignorujemy markery — czas powinien być stabilny (status presence trzymamy osobno na {sn}/status).
          const s = String(p ?? '').trim();
          if (/^(online|offline)$/i.test(s)) return;
          this.state.czasString = s;
          this._renderHeader();
        }],
        ['wifi_rssi_topic_suffix',       (p) => { const v = num(p, null); if (v != null) { this.state.wifiRssi = v; this._renderWifi(); } }],
      ];
      map.forEach(([key, handler]) => {
        const suf = (this.cfg[key] || '').trim();
        if (!suf) return;
        const topic = sn + '/' + suf;
        // Writer cache rejestrowany pierwszy, żeby kolejne wiadomości też wpadały do cache.
        sse.on(topic, (p) => cache.set(topic, p));
        sse.on(topic, handler);
        // Hydrate z cache — odpalamy handler synchronicznie żeby UI miało wartości od razu po F5.
        const cached = cache.get(topic);
        if (cached !== undefined && cached !== null) {
          try { handler(cached); } catch (e) {}
        }
      });

      // Parametry programu własnego — sub na PUB topikach (firmware publikuje aktualne wartości).
      PROG_PARAMS.forEach((p) => {
        const suf = (this.cfg[p.pubKey] || '').trim();
        if (!suf) return;
        const topic = sn + '/' + suf;
        const handler = (payload) => {
          const v = num(payload, null);
          if (v == null) return;
          this.state.programParams[p.key] = v;
        };
        sse.on(topic, (pl) => cache.set(topic, pl));
        sse.on(topic, handler);
        const cached = cache.get(topic);
        if (cached !== undefined && cached !== null) {
          try { handler(cached); } catch (e) {}
        }
      });

      // Presence: {sn}/status (LWT retain) — 'online'/'1' lub 'offline'/'0'.
      // Offline → wymuszamy zerowanie UI bez czyszczenia state (po powrocie online MQTT odświeży realne wartości).
      const statusTopic = sn + '/status';
      const statusHandler = (p) => {
        const v = String(p ?? '').trim().toLowerCase();
        const isOnline = (v === 'online' || v === '1');
        if (this.state.online === isOnline) return;
        this.state.online = isOnline;
        this._renderAll();
      };
      sse.on(statusTopic, (p) => cache.set(statusTopic, p));
      sse.on(statusTopic, statusHandler);
      const cachedStatus = cache.get(statusTopic);
      if (cachedStatus !== undefined && cachedStatus !== null) {
        try { statusHandler(cachedStatus); } catch (e) {}
      }
    }

    _onChamber(p) {
      const v = num(p, null);
      if (v == null) return;
      this.state.chamberTemp = v;
      this._pushHistory();
      this._renderTiles();
      this._renderChart();
    }

    _onMeat(p) {
      const v = num(p, null);
      if (v == null) return;
      this.state.meatTemp = v;
      this._pushHistory();
      this._renderTiles();
      this._renderChart();
    }

    _pushHistory() {
      const c = this.state.chamberTemp;
      const m = this.state.meatTemp;
      if (c == null && m == null) return;
      const t = Date.now();
      // 1) In-memory bufor
      this.history.push({ t, chamber: c, meat: m });
      while (this.history.length > this.MEM_CAP) this.history.shift();
      // 2) IndexedDB (fire-and-forget) — chamber=logIdx 0, meat=logIdx 1.
      if (window.IoTHistoryDB) {
        const wid = this._widgetId();
        const sn = (this.ctx && this.ctx.sn) || '';
        if (c != null && !isNaN(c)) window.IoTHistoryDB.push(wid, 0, sn, t, c);
        if (m != null && !isNaN(m)) window.IoTHistoryDB.push(wid, 1, sn, t, m);
      }
      // 3) Viewport — w follow mode przewijamy do końca; bufor pamięci był shift'owany,
      // więc start trzeba zmniejszyć żeby pokazywać ten sam okno temporal.
      if (this.viewport.follow) {
        this.viewport.start = Math.max(0, this.history.length - this.viewport.count);
      } else if (this.history.length > this.MEM_CAP) {
        this.viewport.start = Math.max(0, this.viewport.start - 1);
      }
    }

    _renderAll() {
      this._renderHeader();
      this._renderWifi();
      this._renderTiles();
      this._renderChart();
      this._renderPhases();
      this._renderProgress();
      this._renderChips();
      this._renderControls();
    }

    _renderWifi() {
      // Offline lub brak RSSI → przekreślona ikona WiFi (analogicznie do thermo-multi).
      // Online + RSSI: 3 słupki, kolor wg progu (>= -60 → 3, >= -75 → 2, inaczej → 1).
      const accent = this.cfg.accent_color || T.green;
      const r = this.state.wifiRssi;
      const offlineDisplay = !this.state.online || r == null;
      if (offlineDisplay) {
        this._slot.wifi.title = !this.state.online ? 'Sterownik offline' : 'WiFi: brak';
        this._slot.wifi.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="display:block">
            <path d="M2 2L22 22" stroke="${T.text1}" stroke-width="2" stroke-linecap="round"/>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" stroke="${T.text1}" stroke-width="2" stroke-linecap="round"/>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" stroke="${T.text1}" stroke-width="2" stroke-linecap="round"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" stroke="${T.text1}" stroke-width="2" stroke-linecap="round"/>
            <line x1="12" y1="20" x2="12.01" y2="20" stroke="${T.text1}" stroke-width="2" stroke-linecap="round"/>
          </svg>`;
        return;
      }
      let level = 1;
      if (r >= -60) level = 3;
      else if (r >= -75) level = 2;
      const heights = [4, 7, 10];
      const bars = heights.map((h, i) => {
        const active = (i + 1) <= level;
        const color = active ? accent : T.bg3;
        return `<span style="display:inline-block;width:3px;height:${h}px;background:${color};border-radius:1px;vertical-align:bottom;margin-right:1px;"></span>`;
      }).join('');
      this._slot.wifi.title = `WiFi ${r} dBm`;
      this._slot.wifi.innerHTML = bars;
    }

    _renderHeader() {
      // Offline → ukryj czas i program, pokaż badge OFFLINE.
      if (this._slot.offline) {
        this._slot.offline.style.display = this.state.online ? 'none' : 'inline-block';
      }
      if (!this.state.online) {
        this._slot.elapsed.textContent = '';
        this._slot.program.hidden = true;
        this._slot.programName.textContent = '';
        return;
      }
      // Gdy firmware publikuje gotowy string na /PUB/Czas — używamy go bezpośrednio.
      // W innym przypadku formatujemy z elapsedMinutes.
      // Czas: gdy MANUAL pokazujemy ołówek (klik → ustawienie SUB/Czas); inaczej tylko wartość.
      {
        const timeStr = this.state.czasString || formatTime(this.state.elapsedMinutes);
        const isManual = (this.state.programName || '').toUpperCase() === 'MANUAL';
        this._slot.elapsed.innerHTML = esc(timeStr) +
          (isManual ? ` <span aria-hidden="true" style="font-size:11px;opacity:.85;">✎</span>` : '');
      }
      // Gdy program = "PRZEPIS" (marker custom recipe), wyświetlamy "PRZEPIS - <nazwa>" z recipe_topic_suffix.
      // W innych przypadkach wyświetlamy nazwę programu z program_topic_suffix bezpośrednio.
      const prog = this.state.programName;
      const isCustomRecipe = /^przepis$/i.test(prog);
      const name = isCustomRecipe
        ? (this.state.recipeName ? `PRZEPIS - ${this.state.recipeName}` : 'PRZEPIS')
        : prog;
      if (name) {
        this._slot.program.textContent = '· ' + name;
        this._slot.program.hidden = false;
        this._slot.programName.textContent = name;
      } else {
        this._slot.program.hidden = true;
        this._slot.programName.textContent = '';
      }
    }

    _renderTiles() {
      const accent = this.cfg.accent_color || T.green;
      const unit = this.cfg.unit || '°C';
      const off = !this.state.online;
      const tiles = [
        {
          edit: 'chamber',
          label: this.cfg.chamber_label || 'KOMORA',
          value: off ? null : this.state.chamberTemp,
          target: off ? 0 : this.state.targetChamber,
          color: accent,
          ok: !off && this.state.chamberTemp != null && Math.abs(this.state.chamberTemp - this.state.targetChamber) < 8,
        },
        {
          edit: 'meat',
          label: this.cfg.meat_label || 'SONDA',
          value: off ? null : this.state.meatTemp,
          target: off ? 0 : this.state.targetMeat,
          color: T.amber,
          ok: !off && this.state.meatTemp != null && this.state.meatTemp >= this.state.targetMeat * 0.9,
        },
      ];
      // Edycja celu możliwa tylko gdy online (klik publikuje SUB/TDM lub SUB/TWM).
      const canEdit = !off;
      this._slot.tiles.innerHTML = tiles.map(({ edit, label, value, target, color, ok }) => {
        const display = value == null ? '—' : Math.round(value);
        const fillH = value == null ? 0 : Math.min((value / 200) * 100, 100);
        const editAttr = canEdit ? ` data-edit="${edit}" role="button" tabindex="0" title="Kliknij, aby ustawić cel"` : '';
        return `
          <div${editAttr} style="background:${T.bg2};border:1px solid ${canEdit ? color + '55' : (ok ? color + '44' : T.border)};border-radius:10px;padding:10px 12px;position:relative;overflow:hidden;transition:border-color .3s ease;${canEdit ? 'cursor:pointer;' : ''}">
            <div style="position:absolute;bottom:0;left:0;right:0;height:${fillH}%;background:${color}10;transition:height .6s ease;"></div>
            ${canEdit ? `<span style="position:absolute;top:7px;right:7px;display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:999px;background:${color}22;border:1px solid ${color}66;color:${color};font-size:9px;font-weight:700;letter-spacing:.04em;line-height:1;z-index:1;">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" style="display:block;"><path d="M12 20h9" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/></svg>ZMIEŃ</span>` : ''}
            <div style="position:relative;">
              <div style="font-size:10px;color:${T.text1};text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">${esc(label)}</div>
              <div style="font-size:36px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;line-height:1;text-shadow:0 0 20px ${color}44;">
                ${display}<span style="font-size:16px;color:${T.text1};font-weight:400;">${esc(unit)}</span>
              </div>
              <div style="margin-top:6px;display:flex;align-items:center;justify-content:space-between;">
                <span style="font-size:10px;color:${T.text1};">${target > 0 ? '/' + target + esc(unit) : (canEdit ? 'ustaw cel' : '—')}</span>
                <span style="font-size:9px;font-weight:600;color:${color};text-transform:uppercase;">${ok ? '✓ OK' : '...'}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    _renderChart() {
      const W = 320, H = 80;
      const MIN = 0, MAX = 160;
      const accent = this.cfg.accent_color || T.green;
      const toY = v => H - ((v - MIN) / (MAX - MIN)) * H;

      const slot = this._slot.chart;
      // Usun TYLKO poprzedni SVG — zachowaj toolbar (.iot-sm-toolbar) który jest dodawany raz w _attachPanZoom.
      const oldSvg = slot.querySelector('svg');
      if (oldSvg) oldSvg.remove();
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('preserveAspectRatio', 'none');
      // height:100% — SVG wypełnia responsywny slot (height: clamp ...), więc wykres skaluje się dynamicznie.
      svg.style.cssText = 'display:block;width:100%;height:100%;overflow:visible;';

      const uid = 'sm' + Math.random().toString(36).slice(2, 7);
      svg.innerHTML = `
        <defs>
          <linearGradient id="${uid}-c" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${accent}" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="${accent}" stop-opacity="0.02"/>
          </linearGradient>
          <linearGradient id="${uid}-m" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${T.amber}" stop-opacity="0.16"/>
            <stop offset="100%" stop-color="${T.amber}" stop-opacity="0.01"/>
          </linearGradient>
          <clipPath id="${uid}-clip"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>
        </defs>
      `;

      [40, 80, 120, 160].forEach(v => {
        const ln = document.createElementNS(SVG_NS, 'line');
        ln.setAttribute('x1', 0); ln.setAttribute('x2', W);
        ln.setAttribute('y1', toY(v)); ln.setAttribute('y2', toY(v));
        ln.setAttribute('stroke', T.border); ln.setAttribute('stroke-width', '1');
        svg.appendChild(ln);
      });

      const tCY = toY(this.state.targetChamber);
      const tMY = toY(this.state.targetMeat);
      const dashLine = (y, color, op) => {
        const ln = document.createElementNS(SVG_NS, 'line');
        ln.setAttribute('x1', 0); ln.setAttribute('x2', W);
        ln.setAttribute('y1', y); ln.setAttribute('y2', y);
        ln.setAttribute('stroke', color); ln.setAttribute('stroke-width', '1');
        ln.setAttribute('stroke-dasharray', '4,3'); ln.setAttribute('opacity', op);
        svg.appendChild(ln);
      };
      dashLine(tCY, accent, '0.6');
      dashLine(tMY, T.amber, '0.5');

      // Renderujemy tylko widoczny zakres viewport (pan/zoom).
      const total = this.history.length;
      const count = Math.max(2, Math.min(this.viewport.count | 0, total));
      const start = Math.max(0, Math.min(this.viewport.start | 0, Math.max(0, total - count)));
      const hist = this.history.slice(start, start + count);
      // Wskaźnik pozycji viewportu (mini-pasek u dołu) — tylko gdy nie w follow mode i jest przewinięte.
      if (!this.viewport.follow && total > count) {
        const railY = H - 1;
        const railBg = document.createElementNS(SVG_NS, 'line');
        railBg.setAttribute('x1', 0); railBg.setAttribute('x2', W);
        railBg.setAttribute('y1', railY); railBg.setAttribute('y2', railY);
        railBg.setAttribute('stroke', T.bg3); railBg.setAttribute('stroke-width', '2');
        svg.appendChild(railBg);
        const knob = document.createElementNS(SVG_NS, 'line');
        const x1 = (start / total) * W;
        const x2 = ((start + count) / total) * W;
        knob.setAttribute('x1', x1); knob.setAttribute('x2', x2);
        knob.setAttribute('y1', railY); knob.setAttribute('y2', railY);
        knob.setAttribute('stroke', accent); knob.setAttribute('stroke-width', '2');
        knob.setAttribute('stroke-linecap', 'round');
        svg.appendChild(knob);
      }
      if (hist.length >= 2) {
        const pts = (key) => hist.map((d, i) => [i * (W / (hist.length - 1)), toY(d[key] != null ? d[key] : MIN)]);
        const smooth = (points) => {
          if (points.length < 2) return '';
          let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
          for (let i = 1; i < points.length; i++) {
            const [px, py] = points[i - 1];
            const [cx, cy] = points[i];
            const mx = (px + cx) / 2;
            d += ` C${mx.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`;
          }
          return d;
        };
        const cPts = pts('chamber');
        const mPts = pts('meat');
        const cPath = smooth(cPts);
        const mPath = smooth(mPts);

        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('clip-path', `url(#${uid}-clip)`);
        const areaC = document.createElementNS(SVG_NS, 'path');
        areaC.setAttribute('d', `${cPath} L${W},${H} L0,${H} Z`);
        areaC.setAttribute('fill', `url(#${uid}-c)`);
        const areaM = document.createElementNS(SVG_NS, 'path');
        areaM.setAttribute('d', `${mPath} L${W},${H} L0,${H} Z`);
        areaM.setAttribute('fill', `url(#${uid}-m)`);
        g.appendChild(areaC); g.appendChild(areaM);
        svg.appendChild(g);

        const lineC = document.createElementNS(SVG_NS, 'path');
        lineC.setAttribute('d', cPath);
        lineC.setAttribute('fill', 'none');
        lineC.setAttribute('stroke', accent);
        lineC.setAttribute('stroke-width', '2');
        lineC.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(lineC);

        const lineM = document.createElementNS(SVG_NS, 'path');
        lineM.setAttribute('d', mPath);
        lineM.setAttribute('fill', 'none');
        lineM.setAttribute('stroke', T.amber);
        lineM.setAttribute('stroke-width', '1.5');
        lineM.setAttribute('stroke-linejoin', 'round');
        lineM.setAttribute('stroke-dasharray', '5,3');
        svg.appendChild(lineM);

        const dot = (x, y, r, fill) => {
          const c = document.createElementNS(SVG_NS, 'circle');
          c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', r);
          c.setAttribute('fill', fill); c.setAttribute('stroke', T.bg2); c.setAttribute('stroke-width', '2');
          svg.appendChild(c);
        };
        dot(cPts[cPts.length - 1][0], cPts[cPts.length - 1][1], 4, accent);
        dot(mPts[mPts.length - 1][0], mPts[mPts.length - 1][1], 3.5, T.amber);
      }

      [40, 80, 120].forEach(v => {
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', '3'); t.setAttribute('y', toY(v) - 2);
        t.setAttribute('fill', T.text1); t.setAttribute('font-size', '8');
        t.setAttribute('font-family', '-apple-system,sans-serif');
        t.textContent = v + '°';
        svg.appendChild(t);
      });

      slot.appendChild(svg);
    }

    _renderPhases() {
      const phases = this.state.phases;
      const cur = this.state.currentPhase;
      const isManual = cur === 0 || /^manual$/i.test(this.state.programName || '');

      if (isManual) {
        // Tryb ręczny — pojedyncza etykieta MANUAL, klikalna (otwiera wybór programu).
        // Kolor: czerwony gdy STAT=STOP, zielony w przeciwnym razie.
        const isStop = /^(stop|koniec|gotowe)\b/i.test(this.state.statName || '');
        const color = isStop ? T.red : T.green;
        this._slot.phases.innerHTML = `
          <button type="button" data-prog-pick="1" style="flex:1;text-align:center;padding:6px 0;border:1px dashed ${color}66;border-radius:6px;background:${color}11;cursor:pointer;font:inherit;">
            <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.1em;">TRYB MANUAL</div>
          </button>`;
        const btn = this._slot.phases.querySelector('[data-prog-pick]');
        if (btn) {
          const stop = (e) => e.stopPropagation();
          btn.addEventListener('mousedown', stop);
          btn.addEventListener('touchstart', stop, { passive: true });
          btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this._openProgramSelect(); });
        }
        return;
      }

      // Pasek faz programowych — pomijamy fazy oznaczone hidden:true (RECZNIE=0, KONTROLA=6)
      this._slot.phases.innerHTML = phases.map((ph, i) => {
        if (ph && ph.hidden) return '';
        const active = i === cur;
        const done = i < cur;
        const color = ph.color || T.indigo;
        const labelColor = active ? color : (done ? color + 'aa' : T.text1);
        return `
          <div style="flex:1;min-width:0;text-align:center;">
            <div style="height:4px;border-radius:2px;background:${(done || active) ? color : T.border};margin-bottom:5px;${active ? `box-shadow:0 0 6px ${color};` : ''}transition:all .3s;"></div>
            <div style="font-size:9px;line-height:1.05;color:${labelColor};font-weight:${active ? 600 : 400};white-space:normal;overflow-wrap:anywhere;word-break:break-word;hyphens:auto;">${esc(ph.label || '')}</div>
          </div>
        `;
      }).join('');
    }

    _renderProgress() {
      const off = !this.state.online;
      const total = off ? 0 : (this.state.totalMinutes || 0);
      const elapsed = off ? 0 : (this.state.elapsedMinutes || 0);
      const pct = total > 0 ? Math.min((elapsed / total) * 100, 100) : 0;
      this._slot.progress.style.width = pct + '%';
      this._slot.time.textContent = off ? '— / —' : `${formatTime(elapsed)} / ${formatTime(total)}`;
      this._renderHeader();
    }

    _renderChips() {
      const accent = this.cfg.accent_color || T.green;
      const phases = this.state.phases;
      const cur = this.state.currentPhase | 0;
      const ph = phases[cur] || phases[0];
      const phColor = (ph && ph.color) || T.indigo;
      const LIGHT_ON = '#FCD34D';
      const off = !this.state.online;
      const isManual = cur === 0 || /^manual$/i.test(this.state.programName || '');
      // Zliczamy tylko fazy programowe (bez ukrytych RECZNIE/KONTROLA)
      const visiblePhases = phases.filter(p => p && !p.hidden);
      const visibleCurrent = phases.slice(0, cur + 1).filter(p => p && !p.hidden).length;
      const stageValue = (off || isManual)
        ? '—'
        : `${Math.max(1, Math.min(visibleCurrent, visiblePhases.length))}/${visiblePhases.length}`;
      // Offline → wszystkie wyjścia wymuszone na OFF (kolor szary), niezależnie od ostatnich wartości MQTT.
      const heaterOn = !off && this.state.heaterOn;
      const fan1On   = !off && this.state.fan1On;
      const fan2On   = !off && this.state.fan2On;
      const dymOn    = !off && this.state.dymOn;
      const lightOn  = !off && this.state.lightOn;
      // Grzałka (PID auto — tylko status) + Etap. FAN1/FAN2/Dym/Światło są teraz interaktywne w _renderControls.
      void fan1On; void fan2On; void dymOn; void lightOn; void LIGHT_ON;
      const chips = [
        { label: 'Grzałka', value: heaterOn ? 'ON' : 'OFF', color: heaterOn ? accent : T.text1 },
        { label: 'Etap',    value: stageValue, color: (off || isManual) ? T.text1 : phColor },
      ];
      this._slot.chips.innerHTML = chips.map(({ label, value, color }) => `
        <div style="background:${T.bg0};border-radius:8px;padding:7px 8px;border:1px solid ${color}44;text-align:center;min-width:0;">
          <div style="font-size:9px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">${esc(label)}</div>
          <div style="font-size:13px;font-weight:700;color:${color};">${esc(value)}</div>
        </div>
      `).join('');
    }

    /** Publikuj komendę MQTT na {sn}/{suffix}. */
    _pubCmd(suffix, payload) {
      const sse = this.ctx && this.ctx.sse;
      const sn = this.ctx && this.ctx.sn;
      const suf = String(suffix || '').trim();
      if (!sse || !sn || !suf) return;
      try { sse.publish(sn + '/' + suf, String(payload), sn); }
      catch (e) { try { console.warn('[smoker] publish failed', suf, e); } catch (_) {} }
    }

    /** Interaktywne sterowanie: START/STOP + FAN1/FAN2/DYM (suwak gdy TRIAC, toggle gdy ONOFF) + Światło. */
    _renderControls() {
      const host = this._slot && this._slot.controls;
      if (!host) return;
      const off = !this.state.online;
      const triac = this.state.ctrlMode === 'TRIAC';
      const stopped = /^(stop|koniec|gotowe)\b/i.test(this.state.statName || '');
      const dis = off ? 'disabled' : '';

      // START/STOP (publikuje na SUB/STAT: 'START' / 'STOP'). Gdy pracuje → STOP + kłódka.
      if (stopped) this._runLocked = true; // po zatrzymaniu następny start znów z blokadą
      const locked = this._runLocked;
      let runBtn;
      if (stopped) {
        runBtn = `<button type="button" data-cmd="run" ${dis} style="width:100%;padding:9px 0;border-radius:8px;border:1px solid ${T.green}88;background:${T.green}1c;color:${T.green};font-weight:700;font-size:13px;letter-spacing:.06em;cursor:pointer;${off ? 'opacity:.4;cursor:not-allowed;' : ''}">▶ START</button>`;
      } else {
        const stopBlocked = off || locked;
        const stopBtn = `<button type="button" data-cmd="run" ${stopBlocked ? 'disabled' : ''} title="${locked ? 'Zablokowane — odblokuj kłódką' : ''}" style="flex:1;min-width:0;padding:9px 0;border-radius:8px;border:1px solid ${T.red}88;background:${T.red}1c;color:${T.red};font-weight:700;font-size:13px;letter-spacing:.06em;cursor:pointer;${stopBlocked ? 'opacity:.45;cursor:not-allowed;' : ''}">■ STOP</button>`;
        const lc = locked ? T.amber : T.green;
        const lockBtn = `<button type="button" data-cmd="lock" ${dis} title="${locked ? 'Odblokuj STOP' : 'Zablokuj STOP (chroni przed przypadkowym kliknięciem)'}" style="width:48px;flex:0 0 48px;padding:9px 0;border-radius:8px;border:1px solid ${lc}88;background:${lc}1c;color:${lc};font-size:15px;line-height:1;cursor:pointer;${off ? 'opacity:.4;cursor:not-allowed;' : ''}">${locked ? '🔒' : '🔓'}</button>`;
        runBtn = `<div style="display:flex;gap:8px;align-items:stretch;">${stopBtn}${lockBtn}</div>`;
      }

      const outputs = [
        { key: 'dym',  label: 'Dym',   pct: this.state.dymPct,  on: this.state.dymOn,  color: T.amber },
        { key: 'fan1', label: 'FAN 1', pct: this.state.fan1Pct, on: this.state.fan1On, color: T.indigo },
        { key: 'fan2', label: 'FAN 2', pct: this.state.fan2Pct, on: this.state.fan2On, color: T.indigoL },
      ];
      // FAN1/FAN2/DYM zablokowane gdy STOP (nie można załączyć wyjść przy zatrzymanym sterowniku) lub offline.
      const outBlocked = off || stopped;
      const outDis = outBlocked ? 'disabled' : '';
      const blockTitle = stopped ? 'Najpierw START — przy STOP wyjścia są zablokowane' : '';
      // Komórka bez sztywnej szerokości — układ ustala grid auto-fit (płynnie 1→4 kolumny wg szerokości karty).
      const cell = (inner, blocked) => `<div style="background:${T.bg0};border:1px solid ${T.border};border-radius:8px;padding:8px;min-width:0;${(blocked === undefined ? outBlocked : blocked) ? 'opacity:.45;' : ''}">${inner}</div>`;
      const outHtml = outputs.map((o) => {
        const head = `<div style="font-size:9px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${esc(o.label)}</div>`;
        if (triac) {
          return cell(`${head}
            <div style="display:flex;align-items:center;gap:6px;" title="${esc(blockTitle)}">
              <input type="range" min="0" max="100" step="1" value="${o.pct | 0}" data-pwr="${o.key}" ${outDis} style="flex:1;min-width:0;accent-color:${o.color};height:5px;margin:0;${outBlocked ? 'cursor:not-allowed;' : ''}">
              <span data-pwrval="${o.key}" style="font-size:11px;font-weight:700;color:${o.on ? o.color : T.text1};min-width:30px;text-align:right;">${o.pct | 0}%</span>
            </div>`);
        }
        return cell(`${head}
          <button type="button" data-tgl="${o.key}" ${outDis} title="${esc(blockTitle)}" style="width:100%;padding:6px 0;border-radius:6px;border:1px solid ${o.on ? o.color : T.border};background:${o.on ? o.color + '22' : T.bg0};color:${o.on ? o.color : T.text1};font-weight:700;font-size:12px;cursor:pointer;${outBlocked ? 'cursor:not-allowed;' : ''}">${o.on ? 'ON' : 'OFF'}</button>`);
      }).join('');

      const lightOn = this.state.lightOn;
      const lightCell = cell(`<div style="font-size:9px;color:${T.text1};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Światło</div>
        <button type="button" data-tgl="light" ${dis} style="width:100%;padding:6px 0;border-radius:6px;border:1px solid ${lightOn ? '#FCD34D' : T.border};background:${lightOn ? '#FCD34D22' : T.bg0};color:${lightOn ? '#FCD34D' : T.text1};font-weight:700;font-size:12px;cursor:pointer;${off ? 'opacity:.4;cursor:not-allowed;' : ''}">${lightOn ? 'ON' : 'OFF'}</button>`, off);

      // START/STOP ląduje w slocie 'run' (pod MANUAL/paskiem faz); wyjścia w slocie 'controls'.
      const runHost = (this._slot && this._slot.run) || host;
      runHost.innerHTML = runBtn;
      host.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;">${outHtml}${lightCell}</div>`;

      if (off) return;

      // Drag-propagation: kontrolki nie mogą wyzwalać przeciągania widgetu na dashboardzie.
      const stop = (e) => e.stopPropagation();
      [runHost, host].forEach((h) => h.querySelectorAll('button[data-cmd],button[data-tgl],input[data-pwr]').forEach((el) => {
        el.addEventListener('mousedown', stop);
        el.addEventListener('touchstart', stop, { passive: true });
        el.addEventListener('pointerdown', stop);
      }));

      const lockEl = runHost.querySelector('button[data-cmd="lock"]');
      if (lockEl) lockEl.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        this._runLocked = !this._runLocked;
        this._renderControls();
      });

      const runEl = runHost.querySelector('button[data-cmd="run"]');
      if (runEl) runEl.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const goStop = !/^(stop|koniec|gotowe)\b/i.test(this.state.statName || '');
        if (goStop) {
          if (this._runLocked) return; // STOP zablokowany kłódką — chroni przed przypadkowym kliknięciem
          // STOP: zatrzymaj wyjścia (STAT=STOP) + wróć do MANUAL (PROG=MANUAL) — pełne zatrzymanie cyklu.
          this._pubCmd(this.cfg.stat_sub_topic_suffix, 'STOP');
          this._pubCmd(this.cfg.program_sub_topic_suffix, 'MANUAL');
        } else {
          this._pubCmd(this.cfg.stat_sub_topic_suffix, 'START');
        }
      });

      const isStopped = () => /^(stop|koniec|gotowe)\b/i.test(this.state.statName || '');
      const subFor = { fan1: this.cfg.fan1_sub_topic_suffix, fan2: this.cfg.fan2_sub_topic_suffix, dym: this.cfg.dym_sub_topic_suffix };
      host.querySelectorAll('button[data-tgl]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const k = btn.dataset.tgl;
          if (k === 'light') {
            this._pubCmd(this.cfg.light_sub_topic_suffix, this.state.lightOn ? 0 : 1);
          } else {
            if (isStopped()) return; // STOP → blokada FAN1/FAN2/DYM
            const on = k === 'fan1' ? this.state.fan1On : k === 'fan2' ? this.state.fan2On : this.state.dymOn;
            this._pubCmd(subFor[k], on ? 0 : 100);
          }
        });
      });
      host.querySelectorAll('input[data-pwr]').forEach((sl) => {
        const lbl = host.querySelector(`[data-pwrval="${sl.dataset.pwr}"]`);
        sl.addEventListener('input', () => { if (lbl) lbl.textContent = (sl.value | 0) + '%'; });
        sl.addEventListener('change', (e) => {
          e.stopPropagation();
          if (isStopped()) return; // STOP → blokada
          this._pubCmd(subFor[sl.dataset.pwr], sl.value | 0);
        });
      });
    }

    /** Toolbar tylko z przyciskiem fullscreen — pan/zoom przeniesione do dużego wykresu w popupie. */
    _attachPanZoom() {
      const widget = this;
      const tbHost = this._slot.chartToolbar;
      if (tbHost) {
        const btnStyle = 'width:22px;height:22px;border:1px solid ' + T.border + ';background:' + T.bg0 + ';color:' + T.text0 + ';border-radius:4px;font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;';
        tbHost.innerHTML = `<button type="button" data-fs="1" title="Pełny ekran" style="${btnStyle}">⤢</button>`;
        // Stop propagation tylko gdy click trafia w sam przycisk — pusta przestrzeń toolbara
        // (cały pas o szerokości widgetu) musi przepuszczać mousedown do drag handlera dashboardu.
        const stop = (e) => {
          if (e.target.closest('[data-fs="1"]')) e.stopPropagation();
        };
        tbHost.addEventListener('pointerdown', stop);
        tbHost.addEventListener('mousedown', stop);
        tbHost.addEventListener('touchstart', stop, { passive: true });
        tbHost.querySelector('[data-fs]').addEventListener('click', (e) => {
          e.stopPropagation(); e.preventDefault();
          widget._openFullscreenChart();
        });
      }
    }

    /** Fullscreen modal z dużym wykresem chamber+meat, tooltipem i toolbar [+ − ← → ⤢]. */
    _openFullscreenChart() {
      const existing = document.body.querySelector('.iot-sm-fs-backdrop');
      if (existing) existing.remove();
      const accent = this.cfg.accent_color || T.green;
      // Reset viewport: pokaż całą historię od razu po otwarciu.
      this.viewport.count = Math.max(50, this.history.length);
      this.viewport.start = 0;
      this.viewport.follow = true;

      const backdrop = document.createElement('div');
      backdrop.className = 'iot-sm-fs-backdrop';
      backdrop.innerHTML = `
        <div class="iot-sm-fs-panel">
          <div class="iot-sm-fs-head">
            <div style="display:flex;align-items:center;gap:10px;min-width:0;">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${accent};box-shadow:0 0 8px ${accent};flex-shrink:0;"></span>
              <span style="font-size:14px;font-weight:700;color:${T.text0};text-transform:uppercase;letter-spacing:.06em;">Przebieg temperatury</span>
              <span style="font-size:11px;color:${T.text1};">próbek: ${this.history.length}</span>
              <div style="display:flex;gap:14px;margin-left:14px;">
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:${T.text1};"><svg width="14" height="3"><line x1="0" y1="1.5" x2="14" y2="1.5" stroke="${accent}" stroke-width="2"/></svg>${esc(this.cfg.chamber_label || 'Komora')}</span>
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:${T.text1};"><svg width="14" height="3"><line x1="0" y1="1.5" x2="14" y2="1.5" stroke="${T.amber}" stroke-width="2" stroke-dasharray="4,3"/></svg>${esc(this.cfg.meat_label || 'Mięso')}</span>
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <button type="button" data-pz="in"    title="Przybliż">+</button>
              <button type="button" data-pz="out"   title="Oddal">−</button>
              <button type="button" data-pz="left"  title="W lewo">←</button>
              <button type="button" data-pz="right" title="W prawo">→</button>
              <button type="button" data-pz="reset" title="Reset (live)">⤢</button>
              <button type="button" data-pz="close" title="Zamknij" style="margin-left:8px;color:${T.red};">×</button>
            </div>
          </div>
          <div class="iot-sm-fs-chart">
            <div data-fs-svg style="width:100%;height:100%;"></div>
            <div data-fs-crosshair class="iot-sm-fs-crosshair" hidden></div>
            <div data-fs-tooltip class="iot-sm-fs-tooltip" hidden></div>
          </div>
          <div data-fs-timeline class="iot-sm-fs-timeline"></div>
        </div>
      `;
      document.body.appendChild(backdrop);
      const panel = backdrop.querySelector('.iot-sm-fs-panel');
      const svgHost = backdrop.querySelector('[data-fs-svg]');
      const crosshair = backdrop.querySelector('[data-fs-crosshair]');
      const tooltip = backdrop.querySelector('[data-fs-tooltip]');
      const timeline = backdrop.querySelector('[data-fs-timeline]');

      ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => {
        backdrop.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      });
      const close = () => { backdrop.remove(); this._fsRefresh = null; document.removeEventListener('keydown', escHandler); };
      const escHandler = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', escHandler);
      backdrop.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === backdrop) close(); });

      const refresh = () => {
        svgHost.innerHTML = this._renderChartSvg(800, 360, true);
        this._renderTimeline(timeline);
      };
      refresh();
      this._fsRefresh = refresh;
      this._attachFsChartPanZoom(svgHost);
      this._attachFsTooltip(svgHost, crosshair, tooltip);

      // Toolbar
      panel.querySelectorAll('[data-pz]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation(); e.preventDefault();
          const act = btn.dataset.pz;
          if (act === 'close') return close();
          const total = this.history.length;
          if (total < 2) return;
          const FACTOR = 1.4, PAN_STEP = 0.3;
          const vp = this.viewport;
          if (act === 'in')        vp.count = Math.max(10, Math.round(vp.count / FACTOR));
          else if (act === 'out')  vp.count = Math.min(total, Math.round(vp.count * FACTOR));
          else if (act === 'left') { vp.start = Math.max(0, vp.start - Math.round(vp.count * PAN_STEP)); vp.follow = false; }
          else if (act === 'right'){ const ms = Math.max(0, total - vp.count); vp.start = Math.min(ms, vp.start + Math.round(vp.count * PAN_STEP)); vp.follow = (vp.start === ms); }
          else if (act === 'reset'){ vp.count = vp.defaultCount; vp.follow = true; vp.start = Math.max(0, total - vp.count); }
          const ms = Math.max(0, total - vp.count);
          if (vp.start > ms) vp.start = ms;
          if (vp.follow) vp.start = ms;
          refresh();
          this._renderChart(); // odśwież też mały
        });
      });
    }

    /** Renderuje SVG wykresu chamber+meat z opcjonalnymi etykietami osi (dla fullscreen). */
    _renderChartSvg(W, H, withAxisLabels) {
      const MIN = 0, MAX = 160;
      const accent = this.cfg.accent_color || T.green;
      const toY = v => H - ((v - MIN) / (MAX - MIN)) * H;
      const total = this.history.length;
      const count = Math.max(2, Math.min(this.viewport.count | 0, total || 2));
      const start = Math.max(0, Math.min(this.viewport.start | 0, Math.max(0, total - count)));
      const hist = this.history.slice(start, start + count);
      if (hist.length < 2) {
        return `<svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;background:${T.bg0};border-radius:4px;">
          <text x="${W/2}" y="${H/2}" text-anchor="middle" fill="${T.text1}" font-size="12">brak historii</text>
        </svg>`;
      }
      const uid = 'sf' + Math.random().toString(36).slice(2, 7);
      let grid = '';
      [40, 60, 80, 100, 120, 140].forEach(v => {
        const y = toY(v).toFixed(1);
        grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${T.border}" stroke-width="1" opacity="0.5"/>`;
        if (withAxisLabels) grid += `<text x="4" y="${(parseFloat(y)-2).toFixed(1)}" fill="${T.text1}" font-size="10" font-family="-apple-system,sans-serif" opacity="0.6">${v}°</text>`;
      });
      const tCY = toY(this.state.targetChamber).toFixed(1);
      const tMY = toY(this.state.targetMeat).toFixed(1);
      const tlines = (this.state.targetChamber > 0 ? `<line x1="0" y1="${tCY}" x2="${W}" y2="${tCY}" stroke="${accent}" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>` : '') +
                     (this.state.targetMeat > 0    ? `<line x1="0" y1="${tMY}" x2="${W}" y2="${tMY}" stroke="${T.amber}" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>` : '');
      const smooth = (key) => {
        const pts = hist.map((d, i) => [i * (W / (hist.length - 1)), toY(d[key] != null ? d[key] : MIN)]);
        let p = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
        for (let k = 1; k < pts.length; k++) {
          const [px, py] = pts[k - 1]; const [cx, cy] = pts[k]; const mx = (px + cx) / 2;
          p += ` C${mx.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`;
        }
        return { d: p, last: pts[pts.length - 1] };
      };
      const c = smooth('chamber'), m = smooth('meat');
      return `<svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;background:${T.bg0};border-radius:4px;overflow:visible;">
        <defs>
          <linearGradient id="${uid}-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${accent}" stop-opacity="0.22"/><stop offset="100%" stop-color="${accent}" stop-opacity="0.02"/></linearGradient>
          <linearGradient id="${uid}-m" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${T.amber}" stop-opacity="0.16"/><stop offset="100%" stop-color="${T.amber}" stop-opacity="0.01"/></linearGradient>
        </defs>
        ${grid}
        <path d="${c.d} L${W},${H} L0,${H} Z" fill="url(#${uid}-c)"/>
        <path d="${m.d} L${W},${H} L0,${H} Z" fill="url(#${uid}-m)"/>
        <path d="${c.d}" fill="none" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/>
        <path d="${m.d}" fill="none" stroke="${T.amber}" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="5,3"/>
        ${tlines}
        <circle cx="${c.last[0].toFixed(1)}" cy="${c.last[1].toFixed(1)}" r="4" fill="${accent}" stroke="${T.bg2}" stroke-width="2"/>
        <circle cx="${m.last[0].toFixed(1)}" cy="${m.last[1].toFixed(1)}" r="3.5" fill="${T.amber}" stroke="${T.bg2}" stroke-width="2"/>
      </svg>`;
    }

    _attachFsChartPanZoom(svgHost) {
      svgHost.style.touchAction = 'none';
      svgHost.style.cursor = 'grab';
      const pxToSamples = (dxPx) => {
        const rect = svgHost.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        return (dxPx / rect.width) * this.viewport.count;
      };
      let mState = null;
      svgHost.addEventListener('mousedown', (e) => {
        e.preventDefault();
        mState = { x: e.clientX, startIdx: this.viewport.start };
        svgHost.style.cursor = 'grabbing';
      });
      window.addEventListener('mousemove', (e) => {
        if (!mState) return;
        const total = this.history.length;
        const maxStart = Math.max(0, total - this.viewport.count);
        const newStart = Math.max(0, Math.min(maxStart, Math.round(mState.startIdx - pxToSamples(e.clientX - mState.x))));
        if (newStart === this.viewport.start) return;
        this.viewport.start = newStart;
        this.viewport.follow = (newStart === maxStart);
        if (this._fsRefresh) this._fsRefresh();
      });
      window.addEventListener('mouseup', () => {
        if (!mState) return;
        mState = null;
        svgHost.style.cursor = 'grab';
      });
      svgHost.addEventListener('wheel', (e) => {
        const total = this.history.length;
        if (total < 4) return;
        e.preventDefault();
        const rect = svgHost.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const oldCount = this.viewport.count;
        const factor = e.deltaY > 0 ? 1.25 : 0.8;
        const newCount = Math.max(10, Math.min(total, Math.round(oldCount * factor)));
        const anchor = this.viewport.start + px * oldCount;
        let newStart = Math.round(anchor - px * newCount);
        const maxStart = Math.max(0, total - newCount);
        newStart = Math.max(0, Math.min(maxStart, newStart));
        this.viewport.count = newCount;
        this.viewport.start = newStart;
        this.viewport.follow = (newStart === maxStart);
        if (this._fsRefresh) this._fsRefresh();
      }, { passive: false });
    }

    /** Timeline (oś X z czasami) pod fullscreen chart — ~6 etykiet równo rozłożonych. */
    _renderTimeline(host) {
      if (!host) return;
      const total = this.history.length;
      if (total < 2) { host.innerHTML = ''; return; }
      const count = Math.max(2, Math.min(this.viewport.count | 0, total));
      const start = Math.max(0, Math.min(this.viewport.start | 0, Math.max(0, total - count)));
      const slice = this.history.slice(start, start + count);
      if (slice.length < 2) { host.innerHTML = ''; return; }
      const t0 = slice[0].t;
      const tN = slice[slice.length - 1].t;
      const span = tN - t0;
      const pad = n => String(n).padStart(2, '0');
      const fmt = (ms) => {
        const d = new Date(ms);
        if (span > 86400000) return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        if (span > 300000)   return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };
      const N = 6;
      let html = '';
      for (let k = 0; k <= N; k++) {
        const tt = t0 + (span * k) / N;
        const left = (k / N) * 100;
        const align = k === 0 ? 'flex-start' : k === N ? 'flex-end' : 'center';
        const tx = k === 0 ? 'translateX(0)' : k === N ? 'translateX(-100%)' : 'translateX(-50%)';
        html += `<div style="position:absolute;left:${left}%;top:0;display:flex;flex-direction:column;align-items:${align};transform:${tx};">
          <div style="width:1px;height:5px;background:${T.text1};opacity:0.5;"></div>
          <div style="font-size:10px;color:${T.text1};margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap;">${esc(fmt(tt))}</div>
        </div>`;
      }
      host.innerHTML = html;
    }

    _attachFsTooltip(svgHost, crosshair, tooltip) {
      const formatTime = (ms) => {
        const d = new Date(ms);
        const pad = n => String(n).padStart(2, '0');
        const today = new Date();
        const sameDay = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
        const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        return sameDay ? time : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${time}`;
      };
      const accent = this.cfg.accent_color || T.green;
      const unit = this.cfg.unit || '°C';
      const onMove = (e) => {
        const total = this.history.length;
        if (total < 2) { crosshair.hidden = true; tooltip.hidden = true; return; }
        const count = Math.max(2, Math.min(this.viewport.count | 0, total));
        const start = Math.max(0, Math.min(this.viewport.start | 0, Math.max(0, total - count)));
        const slice = this.history.slice(start, start + count);
        if (slice.length < 2) return;
        const rect = svgHost.getBoundingClientRect();
        const px = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const idx = Math.round((px / rect.width) * (slice.length - 1));
        const sample = slice[idx];
        if (!sample) return;
        const barX = (idx / (slice.length - 1)) * rect.width;
        crosshair.style.left = barX + 'px';
        crosshair.hidden = false;
        const cVal = sample.chamber != null ? sample.chamber.toFixed(1) + unit : '—';
        const mVal = sample.meat    != null ? sample.meat.toFixed(1)    + unit : '—';
        tooltip.innerHTML = `
          <div style="font-size:10px;color:${T.text1};margin-bottom:4px;">${esc(formatTime(sample.t))}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${accent};"></span>
            <span style="font-size:13px;font-weight:700;color:${accent};font-variant-numeric:tabular-nums;">${esc(cVal)}</span>
            <span style="font-size:10px;color:${T.text1};">${esc(this.cfg.chamber_label || 'komora')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${T.amber};"></span>
            <span style="font-size:13px;font-weight:700;color:${T.amber};font-variant-numeric:tabular-nums;">${esc(mVal)}</span>
            <span style="font-size:10px;color:${T.text1};">${esc(this.cfg.meat_label || 'sonda')}</span>
          </div>
        `;
        tooltip.hidden = false;
        const tw = tooltip.offsetWidth || 140;
        const th = tooltip.offsetHeight || 70;
        let left = barX + 12;
        if (left + tw > rect.width) left = barX - tw - 12;
        let top = e.clientY - rect.top - th / 2;
        if (top < 4) top = 4;
        if (top + th > rect.height) top = rect.height - th - 4;
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      };
      svgHost.addEventListener('mousemove', onMove);
      svgHost.addEventListener('mouseleave', () => { crosshair.hidden = true; tooltip.hidden = true; });
      svgHost.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        onMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
      }, { passive: true });
    }
  }

  window.IoTWidgets = window.IoTWidgets || {};
  window.IoTWidgets['smoker'] = SmokerWidget;
})();
