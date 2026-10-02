const HEC_PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"
];

class HierarchyEnergyCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = {};
    this._prefs = null;
    this._prefsLoading = false;
    this._initialized = false;
    this._byId = new Map();
    this._roots = [];
    this._totals = {};
    this._grandTotal = 0;
    this._range = null;
    this._expanded = null;
    this._unsubEnergy = null;
    this._energyColl = null;
    this._pollTimer = null;
    this._loadSeq = 0;
    this._error = null;
    this._loading = false;
    this._clickBound = false;
    this._loadTimer = null;
    this._energyPoll = null;
    this._connectRetry = null;
    this._lastRangeKey = null;
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = Object.assign({
      title: "Consumption by Zone",
      unit: "kWh",
      show_untracked: true,
      expanded_by_default: true,
      expand_areas_by_default: false,
      sort_siblings: "tree",
      untracked_label: "Untracked",
      no_area_label: "No area",
      group_by_area: false,
      suppress_parent_area: true,
      grid_show_out: true,
      show_percent: false,
      bar_scale: "global",
      show_grid_battery: true,
      grid_battery_entity: null,
      grid_battery_estimate: true,
      grid_battery_label: "Grid to Batt",
      show_water: true,
      water_label: "Water",
      max_rows: 300,
      label_width: "30%",
      value_width: "68px",
      percent_width: "34px",
      show_summary: true,
      show_tariff: false,
      tariff_offpeak_label: "Vazio",
      tariff_peak_label: "Fora",
      tariff_decimals: 1,
      tariff_show_percent: true,
      hide_unit_label: false
    }, config);
    this._config.cost = Object.assign({
      peak_entity: "sensor.energy_consumption_fora_do_vazio",
      offpeak_entity: "sensor.energy_consumption_vazio",
      peak_price: 0.23,
      offpeak_price: 0.12,
      unit: "\u20ac"
    }, config.cost || {});
    this._storageKey = "hierarchy-energy-card:" + (config.id || config.title || "default");
    try {
      const stored = localStorage.getItem(this._storageKey);
      if (stored) this._expanded = new Set(JSON.parse(stored));
    } catch (e) { this._expanded = null; }
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
    else if (!this._initialized && !this._prefsLoading && !this._error) this._init();
  }
  get hass() { return this._hass; }

  getCardSize() { return 10; }

  // Lovelace can re-parent/re-render cards, which fires disconnectedCallback
  // (tearing down the date-selector poll + subscription) and then reconnects
  // the SAME element. Without this, the card stays frozen until a page reload.
  connectedCallback() {
    if (this._hass && !this._prefsLoading) this._connectEnergy();
  }

  disconnectedCallback() {
    if (this._unsubEnergy) { try { this._unsubEnergy(); } catch (e) {} this._unsubEnergy = null; }
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    if (this._loadTimer) { clearTimeout(this._loadTimer); this._loadTimer = null; }
    if (this._energyPoll) { clearInterval(this._energyPoll); this._energyPoll = null; }
    if (this._connectRetry) { clearTimeout(this._connectRetry); this._connectRetry = null; }
  }

  async _init() {
    if (this._prefsLoading || !this._hass) return;
    this._prefsLoading = true;
    try {
      const prefs = await this._hass.callWS({ type: "energy/get_prefs" });
      this._prefs = prefs;
      this._buildTree(prefs);
      this._error = null;
      if (this._expanded === null) {
        this._expanded = new Set();
        if (this._config.expanded_by_default) {
          for (const id of this._byId.keys()) this._expanded.add(id);
          if (this._config.expand_areas_by_default) {
            for (const id of this._areaExpandableIds()) this._expanded.add(id);
          }
        }
      }
    } catch (e) {
      this._error = "Could not read the Energy preferences (energy/get_prefs). " +
        "Make sure the account is an administrator. Detail: " + (e && e.message ? e.message : e);
    }
    this._prefsLoading = false;
    this._initialized = true;
    this._connectEnergy();
    this._render();
  }

  _buildTree(prefs) {
    const devs = (prefs && prefs.device_consumption) || [];
    const byId = new Map();
    for (const d of devs) {
      if (!d || !d.stat_consumption) continue;
      byId.set(d.stat_consumption, {
        id: d.stat_consumption,
        name: d.name || this._friendly(d.stat_consumption),
        parentId: d.included_in_stat || null,
        children: []
      });
    }
    for (const n of byId.values()) {
      const p = n.parentId ? byId.get(n.parentId) : null;
      if (p && p !== n) p.children.push(n);
    }
    const roots = [];
    for (const n of byId.values()) {
      const p = n.parentId ? byId.get(n.parentId) : null;
      if (!p || p === n) roots.push(n);
    }
    this._byId = byId;
    this._roots = roots;
  }

  _friendly(id) {
    const st = this._hass && this._hass.states[id];
    return (st && st.attributes && st.attributes.friendly_name) || id;
  }

  _areaOf(id) {
    const h = this._hass;
    const none = { key: "__none__", name: this._config.no_area_label || "No area" };
    if (!h || !h.entities || !h.entities[id]) return none;
    const ent = h.entities[id];
    let areaId = ent.area_id || null;
    if (!areaId && ent.device_id && h.devices && h.devices[ent.device_id]) {
      areaId = h.devices[ent.device_id].area_id || null;
    }
    if (!areaId) return none;
    const area = h.areas ? h.areas[areaId] : null;
    return { key: areaId, name: (area && area.name) ? area.name : areaId, icon: (area && area.icon) ? area.icon : null };
  }

  _connectEnergy() {
    if (!this._hass || !this._hass.connection) return;
    this._findEnergyCollection((coll) => {
      if (!coll) return;
      // The period selector mutates collection.start/end synchronously then
      // calls refresh() (the heavy full-energy fetch). Re-read the two fields
      // so this card reacts immediately. If the shared collection instance
      // changed (panel/key swap, reconnect), drop the stale subscription first.
      if (this._energyColl && this._energyColl !== coll && this._unsubEnergy) {
        try { this._unsubEnergy(); } catch (e) {}
        this._unsubEnergy = null;
      }
      if (this._energyColl !== coll) this._lastRangeKey = null;
      this._energyColl = coll;
      this._startEnergyPoll();
      if (!this._unsubEnergy) {
        try {
          const un = coll.subscribe((sel) => {
            if (!sel || !sel.start || !sel.end) return;
            this._setRange(sel.start, sel.end);
          });
          this._unsubEnergy = (typeof un === "function") ? un : function () {};
        } catch (e) {
          this._error = "Failed to connect to the Energy date selector: " + (e && e.message ? e.message : e);
          this._render();
          return;
        }
      }
      if (coll.start && coll.end) this._setRange(coll.start, coll.end);
    });
  }

  _resolveEnergyCollection() {
    const c = this._hass && this._hass.connection;
    if (!c) return null;
    const panelKey = "_energy_" + (this._hass.panelUrl || "");
    let coll = c[panelKey] || c["_energy"] || null;
    if (coll) return coll;
    for (const k of Object.keys(c)) {
      if (k.charAt(0) !== "_" || k.indexOf("energy") !== 1) continue;
      const v = c[k];
      if (v && typeof v.subscribe === "function" && typeof v.refresh === "function") return v;
    }
    return null;
  }

  _findEnergyCollection(cb) {
    const coll = this._resolveEnergyCollection();
    if (coll) { cb(coll); return; }
    if (this._connectRetry) clearTimeout(this._connectRetry);
    this._connectRetry = setTimeout(() => this._findEnergyCollection(cb), 1000);
  }

  _startEnergyPoll() {
    if (this._energyPoll) return;
    const tick = () => {
      if (!this._hass || !this._hass.connection) return;
      const coll = this._resolveEnergyCollection();
      if (!coll) { this._energyColl = null; return; }
      if (coll !== this._energyColl) { this._connectEnergy(); return; }
      if (coll.start && coll.end) this._setRange(coll.start, coll.end);
    };
    tick();
    this._energyPoll = setInterval(tick, 500);
  }

  _setRange(start, end) {
    if (!start || !end) return;
    const key = start.getTime() + "|" + end.getTime();
    this._range = { start: start, end: end };
    if (key === this._lastRangeKey) return;
    this._lastRangeKey = key;
    this._scheduleLoadStats();
  }

  _scheduleLoadStats() {
    if (this._loadTimer) clearTimeout(this._loadTimer);
    this._loadTimer = setTimeout(() => {
      this._loadTimer = null;
      this._loadStats();
    }, 250);
  }

  _periodFor(start, end) {
    const days = (end.getTime() - start.getTime()) / 86400000;
    if (days > 35) return "month";
    if (days > 2) return "day";
    return "hour";
  }

  _factor(id) {
    const st = this._hass && this._hass.states[id];
    const unit = ((st && st.attributes && st.attributes.unit_of_measurement) || "kWh");
    const u = String(unit).trim().toLowerCase();
    if (u === "wh") return 0.001;
    if (u === "mwh") return 1000;
    if (u === "gwh") return 1000000;
    if (u === "kj") return 1 / 3600;
    if (u === "mj") return 1 / 3.6;
    return 1;
  }

  _displayFactor() {
    const u = String(this._config.unit || "kWh").trim().toLowerCase();
    if (u === "wh") return 1000;
    if (u === "mwh") return 0.001;
    return 1;
  }

  _unitOf(id, fallback) {
    const st = this._hass && this._hass.states[id];
    const u = st && st.attributes && st.attributes.unit_of_measurement;
    return (u == null || u === "") ? fallback : u;
  }

  _collectIds() {
    const ids = new Set(this._byId.keys());
    const srcs = (this._prefs && this._prefs.energy_sources) || [];
    for (const s of srcs) {
      if (!s) continue;
      if (s.stat_energy_from) ids.add(s.stat_energy_from);
      if (s.stat_energy_to) ids.add(s.stat_energy_to);
    }
    const dwtr = (this._prefs && this._prefs.device_consumption_water) || [];
    for (const d of dwtr) {
      if (d && d.stat_consumption) ids.add(d.stat_consumption);
    }
    const c = this._config.cost || {};
    if (c.peak_entity) ids.add(c.peak_entity);
    if (c.offpeak_entity) ids.add(c.offpeak_entity);
    if (this._config.grid_battery_entity) ids.add(this._config.grid_battery_entity);
    return Array.from(ids);
  }

  async _loadStats() {
    if (!this._range || this._byId.size === 0 || !this._hass) return;
    const seq = ++this._loadSeq;
    this._loading = true;
    this._error = null;
    this._render();
    const ids = this._collectIds();
    const start = this._range.start;
    const end = this._range.end;
    const period = this._periodFor(start, end);
    try {
      const res = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: ids,
        period: period,
        types: ["change"]
      });
      if (seq !== this._loadSeq) return;
      const totals = {};
      for (const id of ids) {
        const stats = res ? res[id] : null;
        let sum = 0;
        if (stats) {
          for (const row of stats) {
            const v = row ? row.change : null;
            if (typeof v === "number" && isFinite(v)) sum += v;
          }
        }
        totals[id] = sum * this._factor(id);
      }
      this._totals = totals;
    } catch (e) {
      if (seq !== this._loadSeq) return;
      this._error = "Error fetching statistics: " + (e && e.message ? e.message : e);
    }
    this._loading = false;
    this._render();
  }

  _isExpanded(id) {
    return this._expanded ? this._expanded.has(id) : this._config.expanded_by_default;
  }

  _toggle(id) {
    if (!this._expanded) this._expanded = new Set();
    if (this._expanded.has(id)) this._expanded.delete(id); else this._expanded.add(id);
    this._persistExpanded();
    this._render();
  }

  _persistExpanded() {
    try { localStorage.setItem(this._storageKey, JSON.stringify(Array.from(this._expanded))); } catch (e) {}
  }

  _areaExpandableIds() {
    const ids = [];
    if (!this._config.group_by_area) return ids;
    for (const node of this._byId.values()) {
      if (!node.children.length) continue;
      const keys = new Set();
      for (const c of node.children) keys.add(this._areaOf(c.id).key);
      if (this._config.suppress_parent_area !== false) keys.delete(this._areaOf(node.id).key);
      for (const k of keys) ids.push(node.id + "|area|" + k);
    }
    return ids;
  }

  _allExpandableIds() {
    const ids = [];
    for (const node of this._byId.values()) {
      if (node.children.length) ids.push(node.id);
    }
    return ids.concat(this._areaExpandableIds());
  }

  _allExpanded() {
    const ids = this._allExpandableIds();
    if (!ids.length) return true;
    if (this._expanded === null) return !!this._config.expanded_by_default;
    return ids.every((id) => this._expanded.has(id));
  }

  _expandAll() {
    this._expanded = new Set(this._allExpandableIds());
    this._persistExpanded();
    this._render();
  }

  _collapseAll() {
    this._expanded = new Set();
    this._persistExpanded();
    this._render();
  }

  _untracked(node) {
    let childSum = 0;
    for (const c of node.children) childSum += this._totals[c.id] || 0;
    return Math.max(0, (this._totals[node.id] || 0) - childSum);
  }

  _pctMode() {
    const v = this._config.show_percent;
    if (v === "areas") return "areas";
    if (v === "devices") return "devices";
    if (v === true || v === "all") return "all";
    return "off";
  }

  _flatten() {
    const rows = [];
    const sortValue = this._config.sort_siblings === "value";
    const total = this._roots.reduce((s, r) => s + (this._totals[r.id] || 0), 0);
    this._grandTotal = total;
    const push = (row, value, parentValue) => {
      row.pct = (parentValue && parentValue > 0) ? (value / parentValue) * 100 : null;
      rows.push(row);
    };
    const walk = (node, depth, color, parentValue) => {
      const v = this._totals[node.id] || 0;
      push({
        kind: "node", id: node.id, name: node.name, depth: depth,
        value: v, color: color, entity: node.id,
        hasChildren: node.children.length > 0, expanded: this._isExpanded(node.id)
      }, v, parentValue);
      if (!node.children.length || !this._isExpanded(node.id)) return;
      let kids = node.children.slice();
      if (sortValue) kids.sort((a, b) => (this._totals[b.id] || 0) - (this._totals[a.id] || 0));
      if (this._config.group_by_area) {
        const buckets = new Map();
        for (const k of kids) {
          const a = this._areaOf(k.id);
          if (!buckets.has(a.key)) buckets.set(a.key, { key: a.key, name: a.name, icon: a.icon, kids: [] });
          buckets.get(a.key).kids.push(k);
        }
        for (const b of buckets.values()) b.sum = b.kids.reduce((s, k) => s + (this._totals[k.id] || 0), 0);
        let ownBucket = null;
        if (this._config.suppress_parent_area !== false) {
          const ownKey = this._areaOf(node.id).key;
          ownBucket = buckets.get(ownKey) || null;
          if (ownBucket) buckets.delete(ownKey);
        }
        if (ownBucket) {
          let ok = ownBucket.kids.slice();
          if (sortValue) ok.sort((a, b) => (this._totals[b.id] || 0) - (this._totals[a.id] || 0));
          ok.forEach((k) => walk(k, depth + 1, color, v));
        }
        const list = Array.from(buckets.values());
        if (sortValue) list.sort((a, b) => b.sum - a.sum);
        else list.sort((a, b) => a.name.localeCompare(b.name));
        for (const b of list) {
          const gid = node.id + "|area|" + b.key;
          const gexp = this._isExpanded(gid);
          push({
            kind: "area", id: gid, name: b.name, depth: depth + 1,
            value: b.sum, color: color, hasChildren: true, expanded: gexp, icon: b.icon
          }, b.sum, v);
          if (gexp) b.kids.forEach((k) => walk(k, depth + 2, color, b.sum));
        }
      } else {
        kids.forEach((k) => walk(k, depth + 1, color, v));
      }
      if (this._config.show_untracked) {
        const u = this._untracked(node);
        push({
          kind: "untracked", id: node.id + ":untracked", name: this._config.untracked_label,
          depth: depth + 1, value: u, color: null,
          hasChildren: false, expanded: false
        }, u, v);
      }
    };
    let roots = this._roots.slice();
    if (sortValue) roots.sort((a, b) => (this._totals[b.id] || 0) - (this._totals[a.id] || 0));
    roots.forEach((r, i) => walk(r, 0, HEC_PALETTE[i % HEC_PALETTE.length], total));
    return rows;
  }

  _summary() {
    const t = this._totals;
    const get = (id) => (id && typeof t[id] === "number") ? t[id] : 0;
    const srcs = (this._prefs && this._prefs.energy_sources) || [];
    const s = { total: 0, grid: null, solar: null, battery: null, water: null, cost: null, tariff: null, gridBattery: null, gridBatteryEst: false };
    for (const r of this._roots) s.total += get(r.id);
    for (const src of srcs) {
      if (!src) continue;
      if (src.type === "grid") s.grid = { in: get(src.stat_energy_from), out: get(src.stat_energy_to), entity: src.stat_energy_from || null };
      else if (src.type === "solar") s.solar = { prod: get(src.stat_energy_from), entity: src.stat_energy_from || null };
      else if (src.type === "battery") s.battery = { charge: get(src.stat_energy_to), discharge: get(src.stat_energy_from), entity: src.stat_energy_from || null };
      else if (src.type === "water") s.water = { value: get(src.stat_energy_from), unit: this._unitOf(src.stat_energy_from, "m\u00B3") };
    }
    if (!s.water) {
      const dw = (this._prefs && this._prefs.device_consumption_water) || [];
      const wids = dw.filter((d) => d && d.stat_consumption).map((d) => d.stat_consumption);
      if (wids.length) {
        let total = 0;
        for (const id of wids) total += get(id);
        s.water = { value: total, unit: this._unitOf(wids[0], "m\u00B3") };
      }
    }
    const c = this._config.cost || {};
    if (c.peak_entity || c.offpeak_entity) {
      s.cost = get(c.peak_entity) * (Number(c.peak_price) || 0) + get(c.offpeak_entity) * (Number(c.offpeak_price) || 0);
    }
    if (c.peak_entity || c.offpeak_entity) {
      const off = get(c.offpeak_entity);
      const peak = get(c.peak_entity);
      const tot = off + peak;
      s.tariff = { off: off, peak: peak, total: tot, offPct: tot > 0 ? (off / tot) * 100 : 0, peakPct: tot > 0 ? (peak / tot) * 100 : 0 };
    }
    const gbe = this._config.grid_battery_entity;
    if (gbe) {
      s.gridBattery = get(gbe);
    } else if (this._config.grid_battery_estimate !== false && s.grid && s.battery) {
      s.gridBattery = Math.min(s.battery.charge, s.grid.in);
      s.gridBatteryEst = true;
    }
    return s;
  }

  _summaryHtml() {
    if (!this._config.show_summary || !this._byId.size || !this._range) return "";
    const s = this._summary();
    const u = this._config.unit;
    const us = this._config.hide_unit_label ? "" : (" " + u);
    const chips = [];
    chips.push({ k: "Total", v: this._fmt(s.total) + us, icon: "mdi:home-lightning-bolt", color: "var(--primary-color)" });
    if (s.grid) {
      let v = this._fmt(s.grid.in) + us + " in";
      const showOut = this._config.grid_show_out !== false;
      if (showOut && s.grid.out > 0.005) v += " / " + this._fmt(s.grid.out) + us + " out";
      chips.push({ k: "Grid", e: s.grid.entity, v: v, icon: "mdi:transmission-tower", color: "#e15759" });
    }
    if (s.solar) chips.push({ k: "Solar", e: s.solar.entity, v: this._fmt(s.solar.prod) + us, icon: "mdi:solar-power", color: "#edc948" });
    if (s.battery) chips.push({ k: "Battery", e: s.battery.entity, v: this._fmt(s.battery.charge) + us + " in / " + this._fmt(s.battery.discharge) + us + " out", icon: "mdi:battery-charging", color: "#59a14f" });
    if (this._config.show_grid_battery !== false && s.gridBattery != null) {
      const est = s.gridBatteryEst ? " (est.)" : "";
      chips.push({
        k: this._config.grid_battery_label + est,
        v: this._fmt(s.gridBattery) + us,
        icon: "mdi:battery-plus-variant",
        color: "#2a9d8f",
        e: this._config.grid_battery_entity || null,
        t: s.gridBatteryEst
          ? "Estimated as min(battery charge, grid import). Set grid_battery_entity to a real grid-to-battery energy sensor for an exact value."
          : null
      });
    }
    if (typeof s.cost === "number") chips.push({ k: "Cost", v: this._fmtMoney(s.cost) + " " + (this._config.cost.unit || ""), icon: "mdi:currency-eur", color: "#b07aa1" });
    if (this._config.show_tariff && s.tariff && (s.tariff.total > 0 || s.tariff.off || s.tariff.peak)) {
      let dg = Number(this._config.tariff_decimals);
      if (!isFinite(dg) || dg < 0) dg = 1;
      dg = Math.min(4, Math.round(dg));
      const showPct = this._config.tariff_show_percent !== false;
      const offLabel = this._config.tariff_offpeak_label || "Vazio";
      const peakLabel = this._config.tariff_peak_label || "Fora";
      const offTxt = this._fmtFixed(s.tariff.off, dg);
      const peakTxt = this._fmtFixed(s.tariff.peak, dg);
      const offPct = this._fmtPct(s.tariff.offPct);
      const peakPct = this._fmtPct(s.tariff.peakPct);
      const vHtml = '<span style="color:#59a14f">' + offTxt + (showPct ? " \u00B7 " + offPct : "") + "</span>" +
        ' <span style="opacity:.55">/</span> ' +
        '<span style="color:#e15759">' + peakTxt + (showPct ? " \u00B7 " + peakPct : "") + "</span>" + us;
      chips.push({
        k: "Tariff - Off Peak / Peak",
        vHtml: vHtml,
        icon: "mdi:clock-outline",
        color: "#8e7cc3",
        t: offLabel + " (off-peak) " + this._fmt(s.tariff.off) + " " + u + ", " + offPct + " of tariff \u2014 " +
           peakLabel + " (peak) " + this._fmt(s.tariff.peak) + " " + u + ", " + peakPct + " of tariff. " +
           "Tariff split of grid import for the selected Energy period."
      });
    }
    if (this._config.show_water !== false && s.water) {
      chips.push({
        k: this._config.water_label,
        v: this._fmtNum(s.water.value) + " " + s.water.unit,
        icon: "mdi:water",
        color: "#00acc1",
        t: "Water usage over the selected Energy period. Click the Energy date selector to change the range."
      });
    }
    if (!chips.length) return "";
    return '<div class="summary">' + chips.map((c) =>
      '<div class="chip" style="--chip-color:' + c.color + '"' + (c.e ? ' data-entity="' + this._esc(c.e) + '"' : "") + (c.t ? ' title="' + this._esc(c.t) + '"' : "") + ">" +
        '<ha-icon class="ic" icon="' + c.icon + '"></ha-icon>' +
        '<div class="txt"><span class="k">' + this._esc(c.k) + '</span><span class="v">' + (c.vHtml != null ? c.vHtml : this._esc(c.v)) + "</span></div>" +
      "</div>"
    ).join("") + "</div>";
  }

  _fmt(v) {
    const n = (v || 0) * this._displayFactor();
    const abs = Math.abs(n);
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  _fmtMoney(v) {
    return (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  _fmtNum(v) {
    const n = Number(v) || 0;
    const abs = Math.abs(n);
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  _fmtFixed(v, digits) {
    const n = (Number(v) || 0) * this._displayFactor();
    return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  _fmtPct(p) {
    const v = p >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
    return v + "%";
  }

  _periodText() {
    if (!this._range) return "";
    const f = (d) => d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
    const sameDay = this._range.start.toDateString() === this._range.end.toDateString();
    return sameDay ? f(this._range.start) : f(this._range.start) + " - " + f(this._range.end);
  }

  _esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  _showPctFor(kind, pctMode) {
    if (pctMode === "off") return false;
    if (pctMode === "all") return true;
    if (pctMode === "areas") return kind === "area";
    if (pctMode === "devices") return kind === "node";
    return false;
  }

  _widthFor(r, max) {
    const scale = this._config.bar_scale;
    let pct;
    if (scale === "parent") pct = (r.pct != null) ? r.pct : 0;
    else if (scale === "total") pct = (this._grandTotal > 0) ? (r.value / this._grandTotal) * 100 : 0;
    else pct = (max > 0) ? (r.value / max) * 100 : 0;
    return Math.max(0, Math.min(100, pct));
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    const rows = (this._byId && this._byId.size) ? this._flatten().slice(0, this._config.max_rows) : [];
    let max = 0;
    for (const r of rows) if (r.value > max) max = r.value;
    if (max <= 0) max = 1;
    const pctMode = this._pctMode();

    const body = rows.map((r) => {
      const w = this._widthFor(r, max);
      const indent = Math.round((12 + r.depth * 16) * 0.65);
      const cls = r.kind === "untracked" ? "row untracked"
        : r.kind === "area" ? "row area"
        : "row" + (r.hasChildren ? " parent" : "");
      const color = r.kind === "untracked" ? "var(--disabled-text-color, #9e9e9e)" : (r.color || "var(--primary-color)");
      const toggle = r.hasChildren
        ? '<span class="chev" data-toggle="' + this._esc(r.id) + '">' + (r.expanded ? "\u25BE" : "\u25B8") + "</span>"
        : '<span class="chev empty"></span>';
      const rowIcon = r.kind === "area" ? '<ha-icon class="ric" icon="' + this._esc(r.icon || "mdi:floor-plan") + '"></ha-icon>' : "";
      const nameCls = (r.kind === "untracked" ? "name untracked-name" : "name") + (r.hasChildren ? " clickable" : "");
      const nameAttr = r.hasChildren ? ' data-toggle="' + this._esc(r.id) + '"' : "";
      const pctHtml = (r.pct != null && this._showPctFor(r.kind, pctMode))
        ? '<span class="pct" title="Share of parent">' + this._esc(this._fmtPct(r.pct)) + "</span>"
        : "";
      const rowToggleAttr = (r.kind === "area" && r.hasChildren) ? ' data-toggle="' + this._esc(r.id) + '"' : "";
      const entityAttr = (r.kind === "node" && r.entity) ? ' data-entity="' + this._esc(r.entity) + '"' : "";
      return '<div class="' + cls + '"' + rowToggleAttr + entityAttr + '>' +
        '<div class="label" style="padding-left:' + indent + 'px">' + toggle + rowIcon +
          '<span class="' + nameCls + '"' + nameAttr + ' title="' + this._esc(r.name) + '">' + this._esc(r.name) + "</span>" +
        "</div>" +
        '<div class="barwrap">' +
          '<div class="track"><div class="bar" style="width:' + w.toFixed(2) + "%;background:" + color + '"></div></div>' +
          pctHtml +
          '<div class="val">' + this._fmt(r.value) + (this._config.hide_unit_label ? "" : ' <span class="u">' + this._esc(this._config.unit) + "</span>") + "</div>" +
        "</div>" +
      "</div>";
    }).join("");

    let status = "";
    if (this._error) status = '<div class="status error">' + this._esc(this._error) + "</div>";
    else if (this._loading) status = '<div class="status">Loading...</div>';
    else if (!rows.length) status = '<div class="status">No devices found in the Energy dashboard.</div>';

    const allOpen = this._allExpanded();
    const controls = this._allExpandableIds().length
      ? '<button class="expbtn" data-expandall="' + (allOpen ? "collapse" : "expand") + '" title="' +
          (allOpen ? "Collapse all groups" : "Expand all groups") + '">' +
          (allOpen ? "Collapse all" : "Expand all") + "</button>"
      : "";

    root.innerHTML =
      "<style>" + this._css() + "</style>" +
      "<ha-card>" +
        '<div class="head"><div class="ttl">' + this._esc(this._config.title) + "</div>" +
        '<div class="controls">' + controls +
        '<div class="period">' + this._esc(this._periodText()) + "</div></div></div>" +
        this._summaryHtml() +
        '<div class="card-content">' + body + status + "</div>" +
      "</ha-card>";

    this._bindClicks(root);
  }

  _bindClicks(root) {
    if (this._clickBound) return;
    this._clickBound = true;
    const findIn = (path, attr) => {
      for (const el of path) {
        if (el && el.getAttribute && el.hasAttribute(attr)) return el;
      }
      return null;
    };
    const run = (path) => {
      const ea = findIn(path, "data-expandall");
      if (ea) {
        if (ea.getAttribute("data-expandall") === "collapse") this._collapseAll();
        else this._expandAll();
        return true;
      }
      const tgl = findIn(path, "data-toggle");
      if (tgl) { this._toggle(tgl.getAttribute("data-toggle")); return true; }
      const ent = findIn(path, "data-entity");
      if (ent) {
        const id = ent.getAttribute("data-entity");
        if (id) this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
        return true;
      }
      return false;
    };
    let downPath = null, downX = 0, downY = 0, moved = false, handledAt = 0;
    root.addEventListener("pointerdown", (ev) => {
      downPath = ev.composedPath ? ev.composedPath() : [ev.target];
      downX = ev.clientX; downY = ev.clientY; moved = false;
    }, true);
    root.addEventListener("pointermove", (ev) => {
      if (downPath && (Math.abs(ev.clientX - downX) > 10 || Math.abs(ev.clientY - downY) > 10)) moved = true;
    }, true);
    root.addEventListener("pointercancel", () => { downPath = null; moved = false; }, true);
    root.addEventListener("pointerup", () => {
      const p = downPath; downPath = null;
      if (!p || moved) return;
      if (run(p)) handledAt = Date.now();
    }, true);
    root.addEventListener("click", (ev) => {
      if (Date.now() - handledAt < 900) return;
      run(ev.composedPath ? ev.composedPath() : [ev.target]);
    });
  }

  _css() {
    return `
      :host { display:block; --label-w:${this._config.label_width || "30%"}; --val-w:${this._config.value_width || "68px"}; --pct-w:${this._config.percent_width || "34px"}; }
      .head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; padding:12px 16px 4px; }
      .ttl { font-size:1.05rem; font-weight:600; }
      .controls { display:flex; align-items:center; gap:10px; }
      .period { font-size:0.8rem; color:var(--secondary-text-color); white-space:nowrap; }
      .expbtn { font:inherit; font-size:0.78rem; cursor:pointer; color:var(--primary-color); background:transparent; border:1px solid var(--divider-color, rgba(127,127,127,0.3)); border-radius:6px; padding:3px 8px; white-space:nowrap; }
      .expbtn:hover { background:var(--secondary-background-color, rgba(127,127,127,0.1)); }
      .summary { display:flex; flex-wrap:wrap; gap:6px; padding:6px 12px 6px; }
      .chip { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:8px; background:var(--secondary-background-color, rgba(127,127,127,0.1)); border-left:3px solid var(--chip-color, var(--primary-color)); min-width:72px; }
      .chip[data-entity] { cursor:pointer; }
      .chip[data-entity]:hover { filter:brightness(1.12); }
      .chip .ic { color:var(--chip-color, var(--primary-color)); --mdc-icon-size:20px; flex:0 0 auto; }
      .chip .txt { display:flex; flex-direction:column; }
      .chip .k { font-size:0.68rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--secondary-text-color); }
      .chip .v { font-size:0.9rem; font-variant-numeric:tabular-nums; }
      .card-content { padding:4px 12px 14px; max-height:660px; overflow:auto; }
      .row { display:flex; align-items:center; gap:6px; padding:1px 0; }
      .row[data-entity] { cursor:pointer; border-radius:4px; }
      .row[data-entity]:hover { background:var(--secondary-background-color, rgba(127,127,127,0.08)); }
      .row.parent .name { font-weight:600; }
      .row.area .name { font-weight:600; color:var(--secondary-text-color); }
      .row.area { cursor:pointer; }
      .row.area:hover { background:var(--secondary-background-color, rgba(127,127,127,0.08)); border-radius:4px; }
      @media (pointer: coarse) { .row { padding:3px 0; } .chev { width:20px; font-size:0.95rem; } }
      .label { flex:0 0 var(--label-w); min-width:0; display:flex; align-items:center; gap:4px; overflow:hidden; }
      .name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
      .name.clickable { cursor:pointer; }
      .pct { flex:0 0 var(--pct-w); text-align:right; font-size:0.75rem; color:var(--secondary-text-color); font-variant-numeric:tabular-nums; }
      .ric { --mdc-icon-size:16px; color:var(--secondary-text-color); flex:0 0 auto; }
      .untracked-name { font-style:italic; color:var(--secondary-text-color); }
      .chev { flex:0 0 auto; width:12px; display:inline-block; color:var(--secondary-text-color); cursor:pointer; -webkit-user-select:none; user-select:none; font-size:0.8rem; }
      .chev.empty { cursor:default; }
      .barwrap { flex:1 1 auto; min-width:0; display:flex; align-items:center; gap:6px; }
      .track { flex:1 1 auto; min-width:20px; height:16px; background:var(--divider-color, rgba(127,127,127,0.2)); border-radius:4px; overflow:hidden; }
      .bar { height:100%; border-radius:4px; transition:width .2s ease; }
      .row.untracked .bar { background-image:repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 4px, transparent 4px 8px); }
      .val { flex:0 0 var(--val-w); text-align:right; font-variant-numeric:tabular-nums; font-size:0.9rem; }
      .val .u { font-size:0.75em; }
      .status { padding:10px 4px; color:var(--secondary-text-color); font-size:0.9rem; }
      .status.error { color:var(--error-color, #c62828); }
    `;
  }
}

if (!customElements.get("hierarchy-energy-card")) {
  customElements.define("hierarchy-energy-card", HierarchyEnergyCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "hierarchy-energy-card")) {
  window.customCards.push({
    type: "hierarchy-energy-card",
    name: "Hierarchy Energy Card",
    description: "Indented energy breakdown by upstream device, with period summary, synced to the Energy date picker."
  });
}