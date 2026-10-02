const HPC_PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"
];

class HierarchyPowerCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = {};
    this._prefs = null;
    this._prefsLoading = false;
    this._byId = new Map();
    this._roots = [];
    this._grandTotal = 0;
    this._expanded = null;
    this._error = null;
    this._lastRender = 0;
    this._renderTimer = null;
    this._clickBound = false;
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = Object.assign({
      title: "Live Power",
      unit: "W",
      hide_unit_label: false,
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
      bar_scale: "parent",
      show_summary: true,
      hide_zero: false,
      zero_threshold: 0,
      update_interval: 1,
      label_width: "30%",
      value_width: "68px",
      percent_width: "34px",
      max_rows: 300
    }, config);
    this._storageKey = "hierarchy-power-card:" + (config.id || config.title || "default");
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
    this._scheduleRender();
  }
  get hass() { return this._hass; }

  getCardSize() {
    let n = 0;
    if (this._byId && this._byId.size) {
      let rows = this._flatten();
      if (this._config.hide_zero) {
        const zt = Math.abs(Number(this._config.zero_threshold) || 0);
        rows = rows.filter((r) => Math.abs(r.value) > zt);
      }
      n = rows.slice(0, this._config.max_rows).length;
    }
    return Math.max(3, Math.ceil((n * 24 + 150) / 50));
  }

  disconnectedCallback() {
    if (this._renderTimer) { clearTimeout(this._renderTimer); this._renderTimer = null; }
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
    this._render();
  }

  _buildTree(prefs) {
    const devs = (prefs && prefs.device_consumption) || [];
    const byStat = new Map();
    for (const d of devs) {
      if (!d || !d.stat_consumption) continue;
      byStat.set(d.stat_consumption, {
        id: d.stat_consumption,
        rateId: d.stat_rate || null,
        name: d.name || this._friendly(d.stat_rate || d.stat_consumption),
        parentId: d.included_in_stat || null,
        children: []
      });
    }
    for (const n of byStat.values()) {
      const p = n.parentId ? byStat.get(n.parentId) : null;
      if (p && p !== n) p.children.push(n);
    }
    const roots = [];
    for (const n of byStat.values()) {
      const p = n.parentId ? byStat.get(n.parentId) : null;
      if (!p || p === n) roots.push(n);
    }
    this._byId = byStat;
    this._roots = roots;
  }

  _friendly(id) {
    const st = this._hass && this._hass.states[id];
    return (st && st.attributes && st.attributes.friendly_name) || id;
  }

  _pval(id) {
    if (!id || !this._hass || !this._hass.states[id]) return 0;
    const v = parseFloat(this._hass.states[id].state);
    return isFinite(v) ? v : 0;
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
      for (const c of node.children) keys.add(this._areaOf(c.rateId || c.id).key);
      if (this._config.suppress_parent_area !== false) keys.delete(this._areaOf(node.rateId || node.id).key);
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

  _pctMode() {
    const v = this._config.show_percent;
    if (v === "areas") return "areas";
    if (v === "devices") return "devices";
    if (v === true || v === "all") return "all";
    return "off";
  }

  _untracked(node) {
    let childSum = 0;
    for (const c of node.children) childSum += this._pval(c.rateId);
    return Math.max(0, this._pval(node.rateId) - childSum);
  }

  _flatten() {
    const rows = [];
    const sortValue = this._config.sort_siblings === "value";
    const total = this._roots.reduce((s, r) => s + this._pval(r.rateId), 0);
    this._grandTotal = total;
    const push = (row, value, parentValue) => {
      row.pct = (parentValue && parentValue > 0) ? (value / parentValue) * 100 : null;
      rows.push(row);
    };
    const walk = (node, depth, color, parentValue) => {
      const v = this._pval(node.rateId);
      push({
        kind: "node", id: node.id, name: node.name, depth: depth,
        value: v, color: color, entity: node.rateId || node.id,
        hasChildren: node.children.length > 0, expanded: this._isExpanded(node.id)
      }, v, parentValue);
      if (!node.children.length || !this._isExpanded(node.id)) return;
      let kids = node.children.slice();
      if (sortValue) kids.sort((a, b) => this._pval(b.rateId) - this._pval(a.rateId));
      if (this._config.group_by_area) {
        const buckets = new Map();
        for (const k of kids) {
          const a = this._areaOf(k.rateId || k.id);
          if (!buckets.has(a.key)) buckets.set(a.key, { key: a.key, name: a.name, icon: a.icon, kids: [] });
          buckets.get(a.key).kids.push(k);
        }
        for (const b of buckets.values()) b.sum = b.kids.reduce((s, k) => s + this._pval(k.rateId), 0);
        let ownBucket = null;
        if (this._config.suppress_parent_area !== false) {
          const ownKey = this._areaOf(node.rateId || node.id).key;
          ownBucket = buckets.get(ownKey) || null;
          if (ownBucket) buckets.delete(ownKey);
        }
        if (ownBucket) {
          let ok = ownBucket.kids.slice();
          if (sortValue) ok.sort((a, b) => this._pval(b.rateId) - this._pval(a.rateId));
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
    if (sortValue) roots.sort((a, b) => this._pval(b.rateId) - this._pval(a.rateId));
    roots.forEach((r, i) => walk(r, 0, HPC_PALETTE[i % HPC_PALETTE.length], total));
    return rows;
  }

  _summary() {
    const srcs = (this._prefs && this._prefs.energy_sources) || [];
    const s = { total: 0, grid: null, solar: null, battery: null, soc: null };
    for (const r of this._roots) s.total += this._pval(r.rateId);
    for (const src of srcs) {
      if (!src) continue;
      if (src.type === "grid") s.grid = { net: this._pval(src.stat_rate), entity: src.stat_rate || null };
      else if (src.type === "solar") s.solar = { prod: this._pval(src.stat_rate), entity: src.stat_rate || null };
      else if (src.type === "battery") {
        const pc = src.power_config || {};
        s.battery = { charge: this._pval(pc.stat_rate_to || src.stat_rate), discharge: this._pval(pc.stat_rate_from), entity: pc.stat_rate_to || src.stat_rate || null };
        s.socEntity = src.stat_soc || null;
        if (src.stat_soc && this._hass && this._hass.states[src.stat_soc]) {
          const sv = parseFloat(this._hass.states[src.stat_soc].state);
          if (isFinite(sv)) s.soc = sv;
        }
      }
    }
    return s;
  }

  _summaryHtml() {
    if (!this._config.show_summary || !this._byId.size) return "";
    const s = this._summary();
    const u = this._config.unit;
    const us = this._config.hide_unit_label ? "" : (" " + u);
    const chips = [];
    chips.push({ k: "Total", v: this._fmt(s.total) + us, icon: "mdi:home-lightning-bolt", color: "var(--primary-color)" });
    if (s.grid) {
      const g = s.grid.net;
      let v;
      if (g < 0) v = this._fmt(-g) + us + " in";
      else v = this._fmt(g) + us + " out";
      if (this._config.grid_show_out === false && g > 0) v = "0" + us;
      chips.push({ k: "Grid", e: s.grid.entity, v: v, icon: g < 0 ? "mdi:transmission-tower-import" : "mdi:transmission-tower-export", color: "#e15759" });
    }
    if (s.solar) chips.push({ k: "Solar", e: s.solar.entity, v: this._fmt(s.solar.prod) + us, icon: "mdi:solar-power", color: "#edc948" });
    if (s.battery) {
      const net = s.battery.charge - s.battery.discharge;
      const v = net >= 0
        ? this._fmt(s.battery.charge) + us + " in"
        : this._fmt(s.battery.discharge) + us + " out";
      chips.push({ k: "Battery", e: s.battery.entity, v: v, icon: "mdi:battery-charging", color: "#59a14f" });
    }
    if (s.soc != null) {
      const soc = Math.round(s.soc);
      const lvl = Math.max(0, Math.min(100, Math.round(soc / 10) * 10));
      const socIcon = lvl === 0 ? "mdi:battery-outline" : lvl === 100 ? "mdi:battery" : "mdi:battery-" + lvl;
      chips.push({ k: "SOC", e: s.socEntity, v: soc + " %", icon: socIcon, color: "#59a14f" });
    }
    if (!chips.length) return "";
    return '<div class="summary">' + chips.map((c) =>
      '<div class="chip" style="--chip-color:' + c.color + '"' + (c.e ? ' data-entity="' + this._esc(c.e) + '"' : "") + (c.t ? ' title="' + this._esc(c.t) + '"' : "") + ">" +
        '<ha-icon class="ic" icon="' + c.icon + '"></ha-icon>' +
        '<div class="txt"><span class="k">' + this._esc(c.k) + '</span><span class="v">' + this._esc(c.v) + "</span></div>" +
      "</div>"
    ).join("") + "</div>";
  }

  _displayFactor() {
    const u = String(this._config.unit || "W").trim().toLowerCase();
    if (u === "kw") return 0.001;
    if (u === "mw") return 0.000001;
    return 1;
  }

  _fmt(v) {
    const n = (v || 0) * this._displayFactor();
    const abs = Math.abs(n);
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  _fmtPct(p) {
    const v = p >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
    return v + "%";
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

  _scheduleRender() {
    if (!this._byId || !this._byId.size) return;
    const iv = Math.max(0, (Number(this._config.update_interval) || 1)) * 1000;
    const now = Date.now();
    const since = now - this._lastRender;
    if (since >= iv) {
      this._lastRender = now;
      this._render();
    } else if (!this._renderTimer) {
      this._renderTimer = setTimeout(() => {
        this._renderTimer = null;
        this._lastRender = Date.now();
        this._render();
      }, iv - since);
    }
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    let rows = (this._byId && this._byId.size) ? this._flatten() : [];
    const zeroThr = Math.abs(Number(this._config.zero_threshold) || 0);
    if (this._config.hide_zero) rows = rows.filter((r) => Math.abs(r.value) > zeroThr);
    rows = rows.slice(0, this._config.max_rows);
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
    else if (!rows.length) {
      const idle = this._config.hide_zero && this._byId && this._byId.size;
      status = '<div class="status">' + (idle
        ? "All devices are idle (below " + zeroThr + " " + this._esc(this._config.unit) + ")."
        : "No power devices found in the Energy dashboard.") + "</div>";
    }

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
        '<div class="period">Live</div></div></div>' +
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
      .card-content { padding:4px 12px 14px; }
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
      .bar { height:100%; border-radius:4px; transition:width .25s ease; }
      .row.untracked .bar { background-image:repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 4px, transparent 4px 8px); }
      .val { flex:0 0 var(--val-w); text-align:right; font-variant-numeric:tabular-nums; font-size:0.9rem; }
      .val .u { font-size:0.75em; }
      .status { padding:10px 4px; color:var(--secondary-text-color); font-size:0.9rem; }
      .status.error { color:var(--error-color, #c62828); }
    `;
  }
}

if (!customElements.get("hierarchy-power-card")) {
  customElements.define("hierarchy-power-card", HierarchyPowerCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "hierarchy-power-card")) {
  window.customCards.push({
    type: "hierarchy-power-card",
    name: "Hierarchy Power Card",
    description: "Live indented power breakdown by upstream device, with instant summary chips."
  });
}
