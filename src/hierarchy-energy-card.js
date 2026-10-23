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
    this._carbon = null;
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
    this._pickerEl = null;
    this._pickerTried = false;
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = Object.assign({
      title: "Consumption by Zone",
      unit: "kWh",
      show_untracked: true,
      expanded_by_default: true,
      expand_areas_by_default: false,
      area_sort_by: "name",
      entity_sort_by: "kwh",
      first_level_sort_by: "tree",
      untracked_label: "Untracked",
      untracked_total_entity: null,
      no_area_label: "No area",
      group_by_area: false,
      suppress_parent_area: true,
      grid_show_out: true,
      chip_io_style: "arrows",
      chip_font_size: "small",
      show_percent: false,
      bar_scale: "global",
      show_grid_battery: true,
      grid_battery_entity: null,
      grid_battery_label: "Grid to Batt",
      show_water: true,
      water_label: "Water",
      show_gas: true,
      gas_label: "Gas",
      show_carbon: false,
      carbon_intensity_entity: null,
      carbon_fossil_entity: null,
      low_carbon_label: "Low carbon",
      carbon_intensity_label: "Grid CO\u2082",
      max_rows: 300,
      label_width: "30%",
      value_width: "68px",
      percent_width: "34px",
      show_summary: true,
      show_tariff: false,
      tariff_offpeak_label: "Off-peak",
      tariff_peak_label: "Peak",
      tariff_decimals: 1,
      tariff_display: "both",
      tariff_peak_first: false,
      hide_unit_label: false,
      date_picker: "auto",
      show_cost: false,
      cost_width: "62px",
      cost_decimals: 2,
      cost_show_currency: true,
      use_virtual_energy_zones: false,
      virtual_energy_zones: []
    }, config);
    this._config.cost = Object.assign({
      peak_entity: null,
      offpeak_entity: null,
      peak_price: 0,
      offpeak_price: 0,
      unit: "\u20ac",
      zero_cost_entities: []
    }, config.cost || {});
    // Back-compat: the old `tariff_show_percent` boolean (only present if the
    // user set it) maps onto the new `tariff_display` select.
    if (config.tariff_display === undefined && config.tariff_show_percent !== undefined) {
      this._config.tariff_display = config.tariff_show_percent === false ? "values" : "both";
    }
    this._storageKey = "hierarchy-energy-card:" + (config.id || config.title || "default");
    try {
      const stored = localStorage.getItem(this._storageKey);
      if (stored) this._expanded = new Set(JSON.parse(stored));
    } catch (e) { this._expanded = null; }
    // Zone config changes the tree shape, so rebuild it (prefs are cached).
    if (this._prefs) this._buildTree(this._prefs);
    // A config change (e.g. toggling the carbon chips) should refresh the
    // period statistics even when the selected range has not changed.
    if (this._range) this._scheduleLoadStats();
    this._render();
  }

  static getStubConfig() {
    return { title: "Consumption by Zone", unit: "kWh" };
  }

  static getConfigElement() {
    return document.createElement("hierarchy-energy-card-editor");
  }

  // Declarative editor (HA's built-in form editor, no custom element). HA keeps
  // any config keys not listed here (ha-form merges into the existing data), so
  // hand-written keys and `grid_options` survive a GUI round-trip.
  static getConfigForm() {
    const SORT = [
      { value: "tree", label: "Config order (Energy dashboard)" },
      { value: "name", label: "Name (A-Z)" },
      { value: "kwh", label: "Consumption (largest first)" },
      { value: "cost", label: "Cost (largest first)" }
    ];
    const P = [
      { value: "parent", label: "Share of parent" },
      { value: "total", label: "Share of total" },
      { value: "global", label: "Share of largest" }
    ];
    const PCT = [
      { value: "off", label: "Off" },
      { value: "all", label: "All rows" },
      { value: "areas", label: "Areas only" },
      { value: "devices", label: "Devices only" }
    ];
    const labels = {
      title: "Title", unit: "Unit", show_summary: "Show summary chips",
      max_rows: "Maximum rows", group_by_area: "Group by area",
      suppress_parent_area: "Hide parent's own area", show_untracked: "Show untracked row",
      untracked_label: "Untracked label", no_area_label: "No-area label",
      untracked_total_entity: "Total meter for Untracked",
      grid_show_out: "Show grid export", chip_io_style: "In/out display",
      chip_font_size: "Chip font size",
      first_level_sort_by: "Level 1 (zones) order",
      area_sort_by: "Area rows order", entity_sort_by: "Entities-in-area order",
      bar_scale: "Bar scale", show_percent: "Percentage column",
      label_width: "Label column width", value_width: "Value column width",
      percent_width: "Percent column width", hide_unit_label: "Hide unit suffix",
      expanded_by_default: "Expand groups on load", expand_areas_by_default: "Expand areas on load",
      show_grid_battery: "Show grid-to-battery chip", grid_battery_entity: "Grid-to-battery entity",
      grid_battery_label: "Grid-to-battery label",
      show_water: "Show water chip", water_label: "Water label",
      show_gas: "Show gas chip", gas_label: "Gas label",
      show_carbon: "Show carbon chips", low_carbon_label: "Low-carbon label",
      carbon_intensity_label: "CO\u2082 intensity label",
      carbon_intensity_entity: "CO\u2082 intensity entity",
      carbon_fossil_entity: "Fossil-fuel % entity",
      show_tariff: "Show tariff chip", tariff_offpeak_label: "Off-peak label",
      tariff_peak_label: "Peak label", tariff_decimals: "Tariff decimals",
      tariff_display: "Tariff display", tariff_peak_first: "Peak first",
      date_picker: "Date picker",
      show_cost: "Show cost column", cost_width: "Cost column width",
      cost_decimals: "Cost decimals", cost_show_currency: "Show currency symbol",
      peak_entity: "Peak tariff entity", offpeak_entity: "Off-peak tariff entity",
      peak_price: "Peak price per unit", offpeak_price: "Off-peak price per unit",
      zero_cost_entities: "Zero-cost entities (free loads)", id: "Card ID"
    };
    const helpers = {
      content: "Card heading and the unit used for the totals and rows.",
      tree: "What the indented breakdown shows, how untracked or parent rows are handled, and how many rows render.",
      ordering: "How zones, area rows and the entities inside each area are ordered.",
      visual: "Bar length basis, the percentage column, column widths (including the cost column) and default expansion.",
      chips: "The summary chips above the tree. Grid export can be hidden when you only import.",
      costcolumn: "The optional per-row cost column: whether to show it and its number format.",
      cost: "Tariff entities and prices used to derive the cost column and cost chip.",
      advanced: "Date-range picker behaviour and other rarely changed settings."
    };
    const fieldHelpers = {
      label_width: "CSS size, e.g. 30% or 130px.",
      value_width: "CSS size, e.g. 50px.",
      percent_width: "CSS size, e.g. 25px.",
      cost_width: "CSS size, e.g. 60px. Enable Show cost column for this to take effect.",
      cost_decimals: "Enable Show cost column for this to take effect.",
      chip_io_style: "Show energy direction as arrows or the words in / out.",
      chip_font_size: "Size of the summary chip text and icons.",
      carbon_intensity_entity: "Grid carbon intensity sensor (gCO\u2082eq/kWh). Auto-detected when empty.",
      carbon_fossil_entity: "Grid fossil-fuel percentage sensor. Auto-detected when empty.",
      grid_battery_entity: "Grid-to-battery energy sensor. The chip is hidden when unset.",
      untracked_total_entity: "Whole-house energy sensor. When set, a level-1 Untracked row shows the difference between it and the tracked rows. Needed with virtual energy zones, which have no meter of their own.",
      date_picker: "Auto mounts a picker when the dashboard has none.",
      zero_cost_entities: "Solar-served loads: excluded from cost and shown as a dash.",
      cost_show_currency: "Append the currency symbol to each cost value. Enable Show cost column for this to take effect.",
      id: "Stable key for remembering expand/collapse; set it if two cards share a title."
    };
    return {
      schema: [
        {
          type: "expandable", name: "content", title: "Content", flatten: true,
          schema: [
            { name: "title", selector: { text: {} } },
            { name: "unit", selector: { select: { options: ["kWh", "Wh", "MWh"] } } }
          ]
        },
        {
          type: "expandable", name: "tree", title: "Tree", flatten: true,
          schema: [
            { name: "group_by_area", selector: { boolean: {} } },
            { name: "suppress_parent_area", selector: { boolean: {} } },
            { name: "show_untracked", selector: { boolean: {} } },
            { name: "untracked_label", selector: { text: {} } },
            { name: "untracked_total_entity", selector: { entity: {} } },
            { name: "no_area_label", selector: { text: {} } },
            { name: "max_rows", selector: { number: { min: 1, mode: "box" } } }
          ]
        },
        {
          type: "expandable", name: "ordering", title: "Ordering", flatten: true,
          schema: [
            { name: "first_level_sort_by", selector: { select: { options: SORT } } },
            { name: "area_sort_by", selector: { select: { options: SORT } } },
            { name: "entity_sort_by", selector: { select: { options: SORT } } }
          ]
        },
        {
          type: "expandable", name: "visual", title: "Visual", flatten: true,
          schema: [
            { name: "bar_scale", selector: { select: { options: P } } },
            { name: "show_percent", selector: { select: { options: PCT } } },
            { name: "label_width", selector: { text: {} } },
            { name: "value_width", selector: { text: {} } },
            { name: "percent_width", selector: { text: {} } },
            { name: "cost_width", selector: { text: {} } },
            { name: "hide_unit_label", selector: { boolean: {} } },
            { name: "expanded_by_default", selector: { boolean: {} } },
            { name: "expand_areas_by_default", selector: { boolean: {} } }
          ]
        },
        {
          type: "expandable", name: "chips", title: "Summary chips", flatten: true,
          schema: [
            { name: "show_summary", selector: { boolean: {} } },
            { name: "grid_show_out", selector: { boolean: {} } },
            {
              name: "chip_io_style",
              selector: { select: { options: [
                { value: "arrows", label: "Arrows" },
                { value: "words", label: "in / out" }
              ] } }
            },
            {
              name: "chip_font_size",
              selector: { select: { options: [
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" }
              ] } }
            },
            { name: "show_carbon", selector: { boolean: {} } },
            { name: "carbon_intensity_entity", selector: { entity: {} } },
            { name: "carbon_fossil_entity", selector: { entity: {} } },
            { name: "low_carbon_label", selector: { text: {} } },
            { name: "carbon_intensity_label", selector: { text: {} } },
            { name: "show_grid_battery", selector: { boolean: {} } },
            { name: "grid_battery_entity", selector: { entity: {} } },
            { name: "grid_battery_label", selector: { text: {} } },
            { name: "show_water", selector: { boolean: {} } },
            { name: "water_label", selector: { text: {} } },
            { name: "show_gas", selector: { boolean: {} } },
            { name: "gas_label", selector: { text: {} } },
            { name: "show_tariff", selector: { boolean: {} } },
            { name: "tariff_offpeak_label", selector: { text: {} } },
            { name: "tariff_peak_label", selector: { text: {} } },
            { name: "tariff_decimals", selector: { number: { min: 0, max: 4, mode: "box" } } },
            {
              name: "tariff_display",
              selector: { select: { options: [
                { value: "values", label: "Values only" },
                { value: "percent", label: "Percentage only" },
                { value: "both", label: "Values and percentage" }
              ] } }
            },
            { name: "tariff_peak_first", selector: { boolean: {} } }
          ]
        },
        {
          type: "expandable", name: "costcolumn", title: "Cost column", flatten: true,
          schema: [
            { name: "show_cost", selector: { boolean: {} } },
            { name: "cost_decimals", selector: { number: { min: 0, max: 4, mode: "box" } } },
            { name: "cost_show_currency", selector: { boolean: {} } }
          ]
        },
        {
          type: "expandable", name: "cost", title: "Cost sources", flatten: false,
          schema: [
            { name: "peak_entity", selector: { entity: {} } },
            { name: "offpeak_entity", selector: { entity: {} } },
            { name: "peak_price", selector: { number: { min: 0, mode: "box", step: 0.001 } } },
            { name: "offpeak_price", selector: { number: { min: 0, mode: "box", step: 0.001 } } },
            { name: "unit", selector: { text: {} } },
            { name: "zero_cost_entities", selector: { entity: { multiple: true } } }
          ]
        },
        {
          type: "expandable", name: "advanced", title: "Advanced", flatten: true,
          schema: [
            { name: "id", selector: { text: {} } },
            { name: "date_picker", selector: { select: { options: ["auto", "always", "never"] } } }
          ]
        }
      ],
      computeLabel: (s, data, options) => {
        if (s.name === "unit" && options && options.path && options.path.includes("cost")) {
          return "Currency symbol";
        }
        return labels[s.name];
      },
      computeHelper: (s) => helpers[s.name] ?? fieldHelpers[s.name],
      assertConfig: (config) => {
        if (config.cost !== undefined &&
            (typeof config.cost !== "object" || config.cost === null || Array.isArray(config.cost))) {
          throw new Error("`cost` must be a mapping.");
        }
      }
    };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
    else if (!this._initialized && !this._prefsLoading && !this._error) this._init();
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
    this._applyVirtualZones();
  }

  // ---- virtual zones -------------------------------------------------------
  // A zone owns a list of areas. Every renderer reads the area -> zone map from
  // _zoneIndex(), so an area claimed by two zones can never be counted twice:
  // the first zone in config order keeps it and the others are reported.
  static _normalizeZones(config) {
    const raw = config && config.virtual_energy_zones;
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    const seen = new Set();
    for (const z of list) {
      if (!z || typeof z !== "object") continue;
      const areas = Array.from(new Set(Array.isArray(z.areas)
        ? z.areas.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim())
        : []));
      const hasName = typeof z.name === "string" && !!z.name.trim();
      if (!hasName && !areas.length) continue;
      const name = hasName ? z.name.trim() : "Zone";
      let id = (typeof z.id === "string" && z.id.trim())
        ? z.id.trim()
        : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!id) id = "zone";
      const base = id;
      for (let n = 2; seen.has(id); n++) id = base + "-" + n;
      seen.add(id);
      out.push({ id, name, icon: (typeof z.icon === "string" && z.icon) ? z.icon : null, areas });
    }
    return out;
  }

  _zoneDefs() {
    if (!this._config.use_virtual_energy_zones) return [];
    return HierarchyEnergyCard._normalizeZones(this._config);
  }

  _zoneIndex(defs) {
    const map = new Map();
    const conflicts = [];
    for (const z of defs) {
      for (const a of z.areas) {
        const kept = map.get(a);
        if (kept) { conflicts.push({ area: a, kept: kept.name, dropped: z.name }); continue; }
        map.set(a, z);
      }
    }
    return { map, conflicts };
  }

  // Insert one synthetic node per zone above the real roots. Roots whose area is
  // in no zone stay top-level, so nothing disappears. Membership is decided by
  // the root's own area only — a mixed-area device subtree is never split, which
  // would double-count it.
  _applyVirtualZones() {
    const defs = this._zoneDefs();
    this._zoneConflicts = [];
    if (!defs.length) return;
    const { map, conflicts } = this._zoneIndex(defs);
    this._zoneConflicts = conflicts;
    const buckets = new Map(defs.map((d) => [d.id, []]));
    const loose = [];
    for (const r of this._roots) {
      const z = map.get(this._areaOf(r.id).key);
      if (z) buckets.get(z.id).push(r); else loose.push(r);
    }
    const zones = [];
    for (const d of defs) {
      const kids = buckets.get(d.id);
      if (!kids.length) continue;
      const zn = { id: "vzone:" + d.id, name: d.name, icon: d.icon, virtual: true, children: kids };
      this._byId.set(zn.id, zn);
      zones.push(zn);
    }
    this._roots = zones.concat(loose);
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

  // Decide whether the card should render its own built-in energy-date-selection.
  // "never"  -> never. "always" -> always. "auto" -> only when the dashboard
  // has no Energy date selector / collection to follow.
  _pickerMode() {
    const m = String(this._config.date_picker || "auto").toLowerCase();
    if (m === "never" || m === "false" || m === "off") return "never";
    if (m === "always" || m === "true" || m === "on") return "always";
    return "auto";
  }

  _hasExternalPicker() {
    if (this._resolveEnergyCollection()) return true;
    // A selector rendered by Lovelace lives in the light DOM; ours lives in our
    // shadow root, so this cannot match ourselves.
    return typeof document !== "undefined" && !!document.querySelector("hui-energy-date-selection-card");
  }

  _pickerDesired() {
    const mode = this._pickerMode();
    if (mode === "never") return false;
    if (mode === "always") return true;
    return !this._hasExternalPicker();
  }

  _maybePickerHtml() {
    return this._pickerDesired() ? '<div class="picker"></div>' : "";
  }

  // Mount the built-in `energy-date-selection` card inside our shadow root.
  // Using loadCardHelpers().createCardElement() triggers the lazy import of the
  // real card; creating the element directly would not.
  async _maybeMountPicker() {
    if (!this._pickerDesired() || !this._hass) return;
    const slot = this.shadowRoot && this.shadowRoot.querySelector(".picker");
    if (!slot) return;
    // _render() rewrites innerHTML, which detaches the picker element. Re-attach
    // the same instance rather than rebuilding it (avoids a full re-fetch).
    if (this._pickerEl) {
      this._pickerEl.hass = this._hass;
      if (this._pickerEl.parentNode !== slot) slot.appendChild(this._pickerEl);
      return;
    }
    if (this._pickerTried) return;
    this._pickerTried = true;
    const helpers = (typeof window !== "undefined" && window.loadCardHelpers)
      ? await window.loadCardHelpers() : null;
    if (!helpers || typeof helpers.createCardElement !== "function") {
      slot.innerHTML = '<div class="picker-hint">No Energy date selector found. ' +
        "Add an <code>energy-date-selection</code> card to this dashboard, or set " +
        "<code>date_picker: never</code> and place one yourself.</div>";
      return;
    }
    let el = null;
    try {
      el = await Promise.resolve(helpers.createCardElement({
        type: "energy-date-selection",
        disable_compare: true
      }));
    } catch (e) { el = null; }
    if (!el) {
      slot.innerHTML = '<div class="picker-hint">Could not create the Energy date selector.</div>';
      return;
    }
    el.hass = this._hass;
    this._pickerEl = el;
    slot.appendChild(el);
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
    const ids = new Set();
    // `_byId` also holds synthetic zone nodes, which have no statistics.
    for (const n of this._byId.values()) if (!n.virtual) ids.add(n.id);
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
    if (this._config.untracked_total_entity) ids.add(this._config.untracked_total_entity);
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
    const carb = this._config.show_carbon ? this._carbonIds() : {};
    const carbonIds = [carb.intensity, carb.fossil].filter(Boolean);
    const statIds = Array.from(new Set(ids.concat(carbonIds)));
    const start = this._range.start;
    const end = this._range.end;
    const period = this._periodFor(start, end);
    try {
      const res = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: statIds,
        period: period,
        types: ["change", "mean"]
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
      if (this._config.show_carbon) this._carbon = this._computeCarbon(res, carb);
    } catch (e) {
      if (seq !== this._loadSeq) return;
      this._error = "Error fetching statistics: " + (e && e.message ? e.message : e);
    }
    this._loading = false;
    this._render();
  }

  // Grid carbon sensors (Electricity Maps by default). Explicit config wins;
  // otherwise auto-detect: intensity by its gCO2eq/kWh unit, fossil share by id.
  _carbonIds() {
    let intensity = this._config.carbon_intensity_entity || null;
    let fossil = this._config.carbon_fossil_entity || null;
    const states = (this._hass && this._hass.states) || {};
    if (!intensity) {
      for (const id in states) {
        const a = states[id] && states[id].attributes;
        const u = a && a.unit_of_measurement;
        if (typeof u === "string" && /co2eq/i.test(u) && /kwh/i.test(u)) { intensity = id; break; }
      }
    }
    if (!fossil) {
      for (const id in states) {
        if (/fossil_fuel_percentage/.test(id)) { fossil = id; break; }
      }
    }
    return { intensity: intensity, fossil: fossil };
  }

  // Period averages for the carbon sensors. Each stats bucket's mean is
  // weighted by the grid import in that same bucket, so an hour that drew a lot
  // of grid power counts for more; falls back to a plain mean without grid data.
  _computeCarbon(res, carb) {
    const gridIds = [];
    for (const s of (this._prefs && this._prefs.energy_sources) || []) {
      if (s && s.type === "grid" && s.stat_energy_from) gridIds.push(s.stat_energy_from);
    }
    const weights = new Map();
    for (const gid of gridIds) {
      const stats = res ? res[gid] : null;
      if (!stats) continue;
      for (const row of stats) {
        const v = row ? row.change : null;
        if (typeof v === "number" && isFinite(v)) weights.set(row.start, (weights.get(row.start) || 0) + v * this._factor(gid));
      }
    }
    const wavg = (id) => {
      const stats = id ? (res ? res[id] : null) : null;
      if (!stats) return null;
      let wsum = 0, wacc = 0, ssum = 0, n = 0;
      for (const row of stats) {
        const m = row ? row.mean : null;
        if (typeof m !== "number" || !isFinite(m)) continue;
        const w = weights.get(row.start) || 0;
        wsum += w; wacc += m * w; ssum += m; n++;
      }
      if (wsum > 0) return wacc / wsum;
      if (n > 0) return ssum / n;
      return null;
    };
    const intensity = wavg(carb.intensity);
    const fossil = wavg(carb.fossil);
    return {
      intensityId: carb.intensity || null,
      fossilId: carb.fossil || null,
      intensity: intensity,
      low: (fossil == null) ? null : Math.max(0, Math.min(100, 100 - fossil))
    };
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
    const rootIds = new Set(this._roots.map((r) => r.id));
    for (const node of this._byId.values()) {
      if (!node.children.length) continue;
      const keys = new Set();
      for (const c of node.children) keys.add(this._areaOf(c.id).key);
      if (this._config.suppress_parent_area !== false && !rootIds.has(node.id)) {
        keys.delete(this._areaOf(node.id).key);
      }
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

  // Entities whose energy is not grid-billed (e.g. solar-served EV / hot water).
  // They carry zero cost AND are excluded from the cost allocation base, so they
  // do not dilute the per-kWh rate applied to the grid-billed lines. Exact
  // statistic/entity ids only — names are user-editable and unsafe to match on.
  _zeroCostSet() {
    const raw = (this._config.cost && this._config.cost.zero_cost_entities) || [];
    const list = Array.isArray(raw) ? raw : [raw];
    const set = new Set();
    for (const x of list) if (typeof x === "string" && x.trim()) set.add(x.trim());
    return set;
  }

  _pctMode() {
    const v = this._config.show_percent;
    if (v === "areas") return "areas";
    if (v === "devices") return "devices";
    if (v === true || v === "all") return "all";
    return "off";
  }

  // Ordering. Three independent user-facing knobs, each one of:
  //   name  — A-Z (locale-aware)
  //   kwh   — value/consumption, largest first
  //   cost  — allocated cost, largest first (energy card; falls back to kwh)
  //   tree  — the order the entries appear in the Energy dashboard
  //   - `first_level_sort_by` orders the level-1 roots (the zones/top devices).
  //   - `area_sort_by` orders the area *group* rows (level 2).
  //   - `entity_sort_by` orders leaves inside an area (level 3+).
  // Each returns a compare function, or null for "tree"/unknown, which callers
  // treat as "leave as written".
  _sortMode(value, fallback) {
    const v = (value == null ? "" : String(value)).toLowerCase();
    if (v === "name" || v === "kwh" || v === "cost" || v === "tree") return v;
    return fallback;
  }

  // Build a node comparator for the given mode over rows/nodes with `id`+`name`.
  _nodeComparator(mode, zeroOf) {
    if (mode === "tree") return null;
    let inner;
    if (mode === "name") {
      inner = (a, b) => a.name.localeCompare(b.name);
    } else if (mode === "cost") {
      const unit = this._costUnit;
      const w = this._weight;
      inner = (a, b) => (((w.get(b.id) || 0) - (w.get(a.id) || 0)) * unit) || a.name.localeCompare(b.name);
    } else {
      inner = (a, b) => ((this._totals[b.id] || 0) - (this._totals[a.id] || 0)) || a.name.localeCompare(b.name);
    }
    if (!zeroOf) return inner;
    // Zero rows always sink to the bottom so the live lines stay on top.
    const zero = (n) => zeroOf(n) * this._displayFactor() < 0.005;
    return (a, b) => (zero(a) !== zero(b)) ? (zero(a) ? 1 : -1) : inner(a, b);
  }

  _entityComparator() {
    let mode = this._sortMode(this._config.entity_sort_by, "kwh");
    // No cost series on this card (or card has no cost): fall back to value.
    if (mode === "cost" && !this._hasCost) mode = "kwh";
    return this._nodeComparator(mode, (n) => this._totals[n.id] || 0);
  }

  // Level-1 roots. Kept separate from entity sorting so a user can hand-order
  // their zones (`tree`) while leaves still sort by consumption.
  _rootComparator() {
    let mode = this._sortMode(this._config.first_level_sort_by, "tree");
    if (mode === "cost" && !this._hasCost) mode = "kwh";
    return this._nodeComparator(mode, (n) => this._totals[n.id] || 0);
  }

  _areaComparator() {
    const mode = this._sortMode(this._config.area_sort_by, "name");
    if (mode === "tree") return null;
    const zero = (b) => (b.sum || 0) * this._displayFactor() < 0.005;
    let inner;
    if (mode === "name") {
      inner = (a, b) => a.name.localeCompare(b.name);
    } else if (mode === "cost" && this._hasCost) {
      inner = (a, b) => ((b.cost || 0) - (a.cost || 0)) || a.name.localeCompare(b.name);
    } else {
      inner = (a, b) => ((b.sum || 0) - (a.sum || 0)) || a.name.localeCompare(b.name);
    }
    return (a, b) => (zero(a) !== zero(b)) ? (zero(a) ? 1 : -1) : inner(a, b);
  }

  _flatten() {
    const rows = [];
    // A synthetic zone is worth the sum of its member roots. Set before anything
    // reads totals: _summary(), the cost weights and the comparators use them.
    for (const r of this._roots) {
      if (!r.virtual) continue;
      this._totals[r.id] = r.children.reduce((s, c) => s + (this._totals[c.id] || 0), 0);
    }
    const total = this._roots.reduce((s, r) => s + (this._totals[r.id] || 0), 0);
    this._grandTotal = total;
    // Level-1 Untracked. A virtual zone has no meter of its own to subtract its
    // members from, so the gap can only come from an explicit whole-house total.
    const meterId = this._config.untracked_total_entity;
    const meterTotal = meterId ? (this._totals[meterId] || 0) : null;
    const gap = (meterTotal != null) ? Math.max(0, meterTotal - total) : 0;
    // Per-row cost is a pro-rata allocation of the whole-period cost the card
    // already computes for the "Cost" chip. Allocation uses a per-node "cost
    // weight" — grid-billed energy — rather than raw energy, so that entries in
    // `cost.zero_cost_entities` (solar-served loads) are free and, crucially,
    // do not dilute the rate applied to the grid-billed lines:
    //   weight(node) = zeroCost(node) ? 0
    //                : (value - Σ value(children)) + Σ weight(child)
    // Marking a node zero-cost zeroes its whole subtree. The invariants still
    // hold: children + Untracked sum to the parent, and roots sum to the chip.
    const summary = this._summary();
    const zeroCost = this._zeroCostSet();
    const weight = new Map();
    const own = new Map();
    const valueOf = (id) => this._totals[id] || 0;
    const computeWeight = (node, frozen) => {
      const free = frozen || zeroCost.has(node.id);
      const v = valueOf(node.id);
      let childValue = 0;
      let childWeight = 0;
      for (const c of node.children) {
        childValue += valueOf(c.id);
        childWeight += computeWeight(c, free);
      }
      const ownWeight = free ? 0 : Math.max(0, v - childValue);
      own.set(node.id, ownWeight);
      const w = free ? 0 : (ownWeight + childWeight);
      weight.set(node.id, w);
      return w;
    };
    let costBase = 0;
    for (const r of this._roots) costBase += computeWeight(r, false);
    // Untracked is part of the same bill, so it joins the allocation base and
    // takes its pro-rata share; every visible cost still sums to the chip.
    costBase += gap; 
    const hasCost = typeof summary.cost === "number" && isFinite(summary.cost) && costBase > 0;
    this._hasCost = hasCost;
    this._costUnit = hasCost ? (summary.cost / costBase) : 0;
    this._weight = weight;
    const cmpEntity = this._entityComparator();
    const cmpRoot = this._rootComparator();
    const cmpArea = this._areaComparator();
    const push = (row, value, parentValue, costValue) => {
      row.pct = (parentValue > 0) ? (value / parentValue) * 100 : (value > 0 ? null : 0);
      row.cost = hasCost ? ((costValue || 0) * this._costUnit) : null;
      rows.push(row);
    };
    const walk = (node, depth, color, parentValue, enclosingKey) => {
      const v = this._totals[node.id] || 0;
      push({
        kind: node.virtual ? "zone" : "node", id: node.id, name: node.name, depth: depth,
        value: v, color: this._tint(color, depth), entity: node.virtual ? null : node.id,
        zeroCost: !node.virtual && zeroCost.has(node.id),
        hasChildren: node.children.length > 0, expanded: this._isExpanded(node.id), icon: node.icon || null
      }, v, parentValue, weight.get(node.id));
      if (!node.children.length || !this._isExpanded(node.id)) return;
      let kids = node.children.slice();
      if (cmpEntity) kids.sort(cmpEntity);
      if (this._config.group_by_area || node.virtual) {
        const buckets = new Map();
        for (const k of kids) {
          const a = this._areaOf(k.id);
          if (!buckets.has(a.key)) buckets.set(a.key, { key: a.key, name: a.name, icon: a.icon, kids: [] });
          buckets.get(a.key).kids.push(k);
        }
        for (const b of buckets.values()) {
          b.sum = b.kids.reduce((s, k) => s + (this._totals[k.id] || 0), 0);
          b.weight = b.kids.reduce((s, k) => s + (weight.get(k.id) || 0), 0);
        }
        let ownBucket = null;
        if (this._config.suppress_parent_area !== false && enclosingKey !== null) {
          const ownKey = this._areaOf(node.id).key;
          if (ownKey === enclosingKey) {
            ownBucket = buckets.get(ownKey) || null;
            if (ownBucket) buckets.delete(ownKey);
          }
        }
        if (ownBucket) {
          let ok = ownBucket.kids.slice();
          if (cmpEntity) ok.sort(cmpEntity);
          ok.forEach((k) => walk(k, depth + 1, color, v, enclosingKey));
        }
        const list = Array.from(buckets.values());
        for (const b of list) b.cost = b.weight * this._costUnit;
        if (cmpArea) list.sort(cmpArea);
        for (const b of list) {
          const gid = node.id + "|area|" + b.key;
          const gexp = this._isExpanded(gid);
          push({
            kind: "area", id: gid, name: b.name, depth: depth + 1,
            value: b.sum, color: this._tint(color, depth + 1), hasChildren: true, expanded: gexp, icon: b.icon
          }, b.sum, v, b.weight);
          if (gexp) b.kids.forEach((k) => walk(k, depth + 2, color, b.sum, b.key));
        }
      } else {
        kids.forEach((k) => walk(k, depth + 1, color, v, null));
      }
      if (this._config.show_untracked && !node.virtual) {
        const u = this._untracked(node);
        push({
          kind: "untracked", id: node.id + ":untracked", name: this._config.untracked_label,
          depth: depth + 1, value: u, color: null,
          hasChildren: false, expanded: false
        }, u, v, own.get(node.id));
      }
    };
    let roots = this._roots.slice();
    if (cmpRoot) roots.sort(cmpRoot);
    roots.forEach((r, i) => walk(r, 0, HEC_PALETTE[i % HEC_PALETTE.length], total, null));
    if (gap > 0 && this._config.show_untracked !== false) {
      push({
        kind: "untracked", id: "untracked:total", name: this._config.untracked_label,
        depth: 0, value: gap, color: null, hasChildren: false, expanded: false
      }, gap, meterTotal, gap);
    }
    return rows;
  }

  _summary() {
    const t = this._totals;
    const get = (id) => (id && typeof t[id] === "number") ? t[id] : 0;
    const srcs = (this._prefs && this._prefs.energy_sources) || [];
    const s = { total: 0, grid: null, solar: null, battery: null, water: null, gas: null, cost: null, tariff: null, gridBattery: null };
    for (const r of this._roots) s.total += get(r.id);
    for (const src of srcs) {
      if (!src) continue;
      if (src.type === "grid") s.grid = { in: get(src.stat_energy_from), out: get(src.stat_energy_to), entity: src.stat_energy_from || null };
      else if (src.type === "solar") s.solar = { prod: get(src.stat_energy_from), entity: src.stat_energy_from || null };
      else if (src.type === "battery") s.battery = { charge: get(src.stat_energy_to), discharge: get(src.stat_energy_from), entity: src.stat_energy_from || null };
      else if (src.type === "water") s.water = { value: get(src.stat_energy_from), unit: this._unitOf(src.stat_energy_from, "m\u00B3") };
      else if (src.type === "gas") s.gas = { value: get(src.stat_energy_from), unit: this._unitOf(src.stat_energy_from, "m\u00B3") };
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
    if (gbe) s.gridBattery = get(gbe);
    return s;
  }

  // Summary-chip font scale. `small` is the historical size; `medium`/`large`
  // step the label, value and icon up. Whitelisted so a bad config value can't
  // reach the class name.
  _chipSize() {
    const v = String(this._config.chip_font_size || "small").toLowerCase();
    return (v === "medium" || v === "large") ? v : "small";
  }

  // Carbon values for the chips: prefer the period average computed in
  // _loadStats; fall back to the sensors' live reading when they have no
  // statistics for the range.
  _carbonValues() {
    const c = this._carbon || {};
    const auto = this._carbonIds();
    const intensityId = c.intensityId || auto.intensity || null;
    const fossilId = c.fossilId || auto.fossil || null;
    const live = (id) => {
      const st = id && this._hass && this._hass.states[id];
      const v = st ? parseFloat(st.state) : NaN;
      return isFinite(v) ? v : null;
    };
    let intensity = (typeof c.intensity === "number") ? c.intensity : live(intensityId);
    let low = (typeof c.low === "number") ? c.low : null;
    if (low == null) {
      const f = live(fossilId);
      if (f != null) low = Math.max(0, Math.min(100, 100 - f));
    }
    return { intensity: intensity, low: low, intensityId: intensityId, fossilId: fossilId };
  }

  _co2Color(v) {
    if (v == null) return null;
    if (v >= 300) return "#e15759";
    if (v >= 150) return "#f28e2b";
    return "#59a14f";
  }

  _lowCarbonColor(p) {
    if (p == null) return null;
    if (p >= 60) return "#59a14f";
    if (p >= 30) return "#f28e2b";
    return "#e15759";
  }

  // An area claimed by two zones is only ever rendered under the first, so say
  // so instead of silently dropping the duplicate.
  _zoneWarningHtml() {
    const defs = this._zoneDefs();
    if (!defs.length) return "";
    if (!defs.some((z) => z.areas.length)) {
      return '<div class="status warn">Virtual Energy Zones are on, but no zone has areas assigned yet.</div>';
    }
    const conflicts = this._zoneConflicts || [];
    if (!conflicts.length) return "";
    const areaName = (id) => {
      const a = this._hass && this._hass.areas ? this._hass.areas[id] : null;
      return (a && a.name) ? a.name : id;
    };
    const parts = conflicts.map((c) => this._esc(areaName(c.area)) +
      " is in both " + this._esc(c.kept) + " and " + this._esc(c.dropped) +
      " \u2014 kept in " + this._esc(c.kept) + ".");
    return '<div class="status warn">' + parts.join(" ") + "</div>";
  }

  _summaryHtml() {
    if (!this._config.show_summary || !this._byId.size || !this._range) return "";
    const s = this._summary();
    const u = this._config.unit;
    const uspan = this._config.hide_unit_label ? "" : " " + this._uSpan(u);
    const io = (dir) => (this._config.chip_io_style === "words")
      ? dir
      : (dir === "in" ? "\u2193" : "\u2191");
    const num = (x) => this._esc(this._fmt(x));
    const chips = [];
    chips.push({ k: "Total", vHtml: num(s.total) + uspan, icon: "mdi:home-lightning-bolt", color: "var(--primary-color)" });
    if (s.grid) {
      const showOut = this._config.grid_show_out !== false && s.grid.out > 0.005;
      let vHtml = num(s.grid.in) + uspan + (showOut ? " " + io("in") : "");
      if (showOut) vHtml += ' <span class="ioSep">/</span> ' + num(s.grid.out) + uspan + " " + io("out");
      chips.push({ k: "Grid", e: s.grid.entity, vHtml: vHtml, icon: "mdi:transmission-tower", color: "#e15759" });
    }
    if (s.solar) chips.push({ k: "Solar", e: s.solar.entity, vHtml: num(s.solar.prod) + uspan, icon: "mdi:solar-power", color: "#edc948" });
    if (s.battery) chips.push({
      k: "Battery", e: s.battery.entity,
      vHtml: '<span class="io in">' + num(s.battery.charge) + uspan + " " + io("in") + "</span>" +
        ' <span class="ioSep">/</span> ' +
        '<span class="io out">' + num(s.battery.discharge) + uspan + " " + io("out") + "</span>",
      icon: "mdi:battery-charging", color: "#59a14f"
    });
    if (this._config.show_grid_battery !== false && s.gridBattery != null) {
      chips.push({
        k: this._config.grid_battery_label,
        vHtml: num(s.gridBattery) + uspan,
        icon: "mdi:battery-plus-variant",
        color: "#2a9d8f",
        e: this._config.grid_battery_entity || null
      });
    }
    if (typeof s.cost === "number") chips.push({
      k: "Cost",
      vHtml: this._esc(this._fmtMoney(s.cost)) + " " + this._uSpan((this._config.cost && this._config.cost.unit) || "\u20ac"),
      icon: "mdi:currency-eur", color: "#b07aa1"
    });
    if (this._config.show_tariff && s.tariff && (s.tariff.total > 0 || s.tariff.off || s.tariff.peak)) {
      let dg = Number(this._config.tariff_decimals);
      if (!isFinite(dg) || dg < 0) dg = 1;
      dg = Math.min(4, Math.round(dg));
      const mode = this._config.tariff_display
        || (this._config.tariff_show_percent === false ? "values" : "both");
      const peakFirst = this._config.tariff_peak_first === true;
      const offLabel = this._config.tariff_offpeak_label || "Off-peak";
      const peakLabel = this._config.tariff_peak_label || "Peak";
      const offTxt = this._esc(this._fmtFixed(s.tariff.off, dg));
      const peakTxt = this._esc(this._fmtFixed(s.tariff.peak, dg));
      const offPct = this._fmtPct(s.tariff.offPct);
      const peakPct = this._fmtPct(s.tariff.peakPct);
      const seg = (txt, pct, color) => '<span style="color:' + color + '">' +
        (mode === "percent" ? pct : (mode === "values" ? txt : txt + " \u00B7 " + pct)) + "</span>";
      const offSeg = seg(offTxt, offPct, "#59a14f");
      const peakSeg = seg(peakTxt, peakPct, "#e15759");
      const tail = mode === "percent" ? "" : uspan;
      const vHtml = (peakFirst
        ? peakSeg + ' <span class="ioSep">/</span> ' + offSeg
        : offSeg + ' <span class="ioSep">/</span> ' + peakSeg) + tail;
      chips.push({
        k: peakFirst ? (peakLabel + " / " + offLabel) : (offLabel + " / " + peakLabel),
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
        vHtml: this._esc(this._fmtNum(s.water.value)) + " " + this._uSpan(s.water.unit),
        icon: "mdi:water",
        color: "#00acc1",
        t: "Water usage over the selected Energy period. Click the Energy date selector to change the range."
      });
    }
    if (this._config.show_gas !== false && s.gas) {
      chips.push({
        k: this._config.gas_label,
        vHtml: this._esc(this._fmtNum(s.gas.value)) + " " + this._uSpan(s.gas.unit),
        icon: "mdi:fire",
        color: "#e67e22",
        t: "Gas usage over the selected Energy period. Click the Energy date selector to change the range."
      });
    }
    if (this._config.show_carbon) {
      const cv = this._carbonValues();
      if (cv.low != null) {
        chips.push({
          k: this._config.low_carbon_label || "Low carbon",
          e: cv.fossilId,
          vHtml: this._esc(String(Math.round(cv.low))) + " " + this._uSpan("%"),
          icon: "mdi:leaf",
          color: this._lowCarbonColor(cv.low),
          t: "Low-carbon share of grid electricity over the selected period (100 \u2212 fossil fuel %)."
        });
      }
      if (cv.intensity != null) {
        chips.push({
          k: this._config.carbon_intensity_label || "Grid CO\u2082",
          e: cv.intensityId,
          vHtml: this._esc(String(Math.round(cv.intensity))) + " " + this._uSpan("gCO\u2082/kWh"),
          icon: "mdi:molecule-co2",
          color: this._co2Color(cv.intensity),
          t: "Average grid carbon intensity over the selected period."
        });
      }
    }
    if (!chips.length) return "";
    return '<div class="summary chip-size-' + this._chipSize() + '">' + chips.map((c) =>
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

  _fmtCostNumber(v) {
    let dg = Number(this._config.cost_decimals);
    if (!isFinite(dg) || dg < 0) dg = 2;
    dg = Math.min(4, Math.round(dg));
    const n = Number(v) || 0;
    return n.toLocaleString(undefined, { minimumFractionDigits: dg, maximumFractionDigits: dg });
  }

  _fmtCost(v) {
    const num = this._fmtCostNumber(v);
    if (this._config.cost_show_currency === false) return num;
    const unit = (this._config.cost && this._config.cost.unit) || "\u20ac";
    return num + " " + unit;
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

  // Validate a user-supplied CSS length before interpolating it into the
  // <style> block. Only simple lengths (number + optional unit) pass; anything
  // else falls back to the default, so a crafted value cannot break out of the
  // custom-property declaration and inject CSS.
  _cssLen(v, fallback) {
    const s = typeof v === "string" ? v.trim() : "";
    if (/^(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|em|rem|ch|vw|vh|vmin|vmax|pt|pc|cm|mm|in|q)?$/.test(s)) return s;
    // Allow functional notations (calc/min/max/clamp/var) but no structural
    // characters (`; { } < > " ' \`) that could break out of the declaration.
    if (/^(?:calc|min|max|clamp|var)\([^;{}<>"'\\]*\)$/.test(s)) return s;
    return fallback;
  }

  _uSpan(unit) {
    return '<span class="u">' + this._esc(unit) + "</span>";
  }

  // Fade a zone's palette colour as it is reused further down the tree, so the
  // hue still identifies the zone branch while depth reads at a glance. Alpha is
  // blended by the browser against whatever is behind the bar (track/card), so
  // it works on both light and dark themes.
  _tint(color, depth) {
    if (!depth || typeof color !== "string" || color.charAt(0) !== "#") return color;
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
    const n = parseInt(hex, 16);
    if (!isFinite(n)) return color;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const a = Math.max(0.3, 1 - depth * 0.25);
    return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(2) + ")";
  }

  _showPctFor(kind, pctMode) {
    if (pctMode === "off") return false;
    if (pctMode === "all") return true;
    if (pctMode === "areas") return kind === "area" || kind === "zone";
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

  // Row indent. The first two levels step by a fixed amount; from the third
  // level on we also clear the area row's icon (chevron + icon + gap) so a
  // level-3 name lines up under the text of the level-2 area, not under its
  // icon.
  _indentFor(depth) {
    const step = 10.4;  // 16px * 0.65
    const base = 7.8;   // 12px * 0.65
    const iconClear = depth >= 2 ? 6 : 0;
    return Math.round(base + depth * step + iconClear);
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    const rows = (this._byId && this._byId.size) ? this._flatten().slice(0, this._config.max_rows) : [];
    let max = 0;
    for (const r of rows) if (r.value > max) max = r.value;
    if (max <= 0) max = 1;
    const pctMode = this._pctMode();
    const showCost = !!this._config.show_cost && this._hasCost;

    const body = rows.map((r) => {
      const w = this._widthFor(r, max);
      const indent = this._indentFor(r.depth);
      const cls = r.kind === "untracked" ? "row untracked"
        : (r.kind === "area" || r.kind === "zone") ? "row area"
        : "row" + (r.hasChildren ? " parent" : "");
      const color = r.kind === "untracked" ? "var(--disabled-text-color, #9e9e9e)" : (r.color || "var(--primary-color)");
      const toggle = r.hasChildren
        ? '<span class="chev" data-toggle="' + this._esc(r.id) + '">' + (r.expanded ? "\u25BE" : "\u25B8") + "</span>"
        : '<span class="chev empty"></span>';
      const rowIcon = (r.kind === "area" || r.kind === "zone")
        ? '<ha-icon class="ric" icon="' + this._esc(r.icon || (r.kind === "zone" ? "mdi:home-group" : "mdi:floor-plan")) + '"></ha-icon>' : "";
      const nameCls = (r.kind === "untracked" ? "name untracked-name" : "name") + (r.hasChildren ? " clickable" : "");
      const nameAttr = r.hasChildren ? ' data-toggle="' + this._esc(r.id) + '"' : "";
      // Fade rows that display as zero (kWh and/or cost) so the live lines stand out.
      const valZero = Math.abs((r.value || 0) * this._displayFactor()) < 0.005;
      // Always reserve the percentage column while it is in use, so every row's
      // track/bar has the same width. Emitting no cell let the track grow into
      // the percentage column ("bar breaks through"), which showed up for a
      // single-child area whose total is 0 (share undefined -> no cell).
      const pctHtml = (pctMode !== "off")
        ? '<span class="pct' + (valZero ? " zero" : "") + '" title="Share of parent">' +
            (this._showPctFor(r.kind, pctMode) ? (r.pct != null ? this._esc(this._fmtPct(r.pct)) : "\u2013") : "") +
          "</span>"
        : "";
      const rowToggleAttr = ((r.kind === "area" || r.kind === "zone") && r.hasChildren) ? ' data-toggle="' + this._esc(r.id) + '"' : "";
      const entityAttr = (r.kind === "node" && r.entity) ? ' data-entity="' + this._esc(r.entity) + '"' : "";
      const costZero = (r.cost == null) || Math.abs(Number(r.cost) || 0) < 0.005;
      const costUnit = (this._config.cost && this._config.cost.unit) || "\u20ac";
      const costInner = this._esc(this._fmtCostNumber(r.cost)) +
        (this._config.cost_show_currency === false ? "" : ' <span class="u">' + this._esc(costUnit) + "</span>");
      const costHtml = showCost
        ? (r.zeroCost
            ? '<div class="cost na" title="Solar-served \u2014 excluded from cost">\u2013</div>'
            : '<div class="cost' + (costZero ? " zero" : "") + '" title="Pro-rata share of the period cost">' + costInner + "</div>")
        : "";
      return '<div class="' + cls + '"' + rowToggleAttr + entityAttr + '>' +
        '<div class="label" style="padding-left:' + indent + 'px">' + toggle + rowIcon +
          '<span class="' + nameCls + (valZero ? " zero" : "") + '"' + nameAttr + ' title="' + this._esc(r.name) + '">' + this._esc(r.name) + "</span>" +
        "</div>" +
        '<div class="barwrap">' +
          '<div class="track"><div class="bar" style="width:' + w.toFixed(2) + "%;background:" + color + '"></div></div>' +
          pctHtml +
          '<div class="val' + (valZero ? " zero" : "") + '">' + this._fmt(r.value) + (this._config.hide_unit_label ? "" : ' <span class="u">' + this._esc(this._config.unit) + "</span>") + "</div>" +
          costHtml +
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
        this._maybePickerHtml() +
        this._zoneWarningHtml() +
        this._summaryHtml() +
        '<div class="card-content">' + body + status + "</div>" +
      "</ha-card>";

    this._bindClicks(root);
    this._maybeMountPicker();
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
      :host { display:block; --label-w:${this._cssLen(this._config.label_width, "30%")}; --val-w:${this._cssLen(this._config.value_width, "68px")}; --pct-w:${this._cssLen(this._config.percent_width, "34px")}; --cost-w:${this._cssLen(this._config.cost_width, "62px")}; }
      .head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; padding:12px 16px 4px; }
      .ttl { font-size:1.05rem; font-weight:600; }
      .controls { display:flex; align-items:center; gap:10px; }
      .period { font-size:0.8rem; color:var(--secondary-text-color); white-space:nowrap; }
      .expbtn { font:inherit; font-size:0.78rem; cursor:pointer; color:var(--primary-color); background:transparent; border:1px solid var(--divider-color, rgba(127,127,127,0.3)); border-radius:6px; padding:3px 8px; white-space:nowrap; }
      .expbtn:hover { background:var(--secondary-background-color, rgba(127,127,127,0.1)); }
      .picker { padding:2px 8px; }
      .picker hui-energy-date-selection-card { display:block; --ha-card-background:transparent; --ha-card-box-shadow:none; --ha-card-border-width:0; }
      .picker-hint { font-size:0.8rem; color:var(--secondary-text-color); padding:6px 4px; }
      .picker-hint code { font-size:0.85em; }
      .summary { display:flex; flex-wrap:wrap; gap:6px; padding:6px 12px 6px; }
      .summary.chip-size-small { --chip-k:0.68rem; --chip-v:0.84rem; --chip-ic:17px; --chip-gap:6px; --chip-pad-y:5px; --chip-pad-x:8px; --chip-minw:64px; }
      .summary.chip-size-medium { --chip-k:0.78rem; --chip-v:0.95rem; --chip-ic:20px; --chip-gap:8px; --chip-pad-y:6px; --chip-pad-x:10px; --chip-minw:72px; }
      .summary.chip-size-large { --chip-k:0.88rem; --chip-v:1.06rem; --chip-ic:24px; --chip-gap:10px; --chip-pad-y:7px; --chip-pad-x:12px; --chip-minw:80px; }
      .chip { display:flex; align-items:center; gap:var(--chip-gap, 8px); padding:var(--chip-pad-y, 6px) var(--chip-pad-x, 10px); border-radius:8px; background:var(--secondary-background-color, rgba(127,127,127,0.1)); border-left:3px solid var(--chip-color, var(--primary-color)); min-width:var(--chip-minw, 72px); }
      .chip[data-entity] { cursor:pointer; }
      .chip[data-entity]:hover { filter:brightness(1.12); }
      .chip .ic { color:var(--chip-color, var(--primary-color)); --mdc-icon-size:var(--chip-ic, 20px); flex:0 0 auto; }
      .chip .txt { display:flex; flex-direction:column; }
      .chip .k { font-size:var(--chip-k, 0.68rem); text-transform:uppercase; letter-spacing:0.03em; color:var(--secondary-text-color); }
      .chip .v { font-size:var(--chip-v, 0.84rem); font-variant-numeric:tabular-nums; }
      .chip .u { font-size:0.72em; }
      .chip .ioSep { opacity:.55; }
      .chip .io.in { color:#4dabf7; }
      .chip .io.out { color:#f59f00; }
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
      .bar { height:100%; border-radius:4px; transition:width .2s ease; }
      .row.untracked .bar { background-image:repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 4px, transparent 4px 8px); }
      .val { flex:0 0 var(--val-w); text-align:right; font-variant-numeric:tabular-nums; font-size:0.85rem; }
      .val .u { font-size:0.75em; }
      .cost { flex:0 0 var(--cost-w); text-align:right; font-variant-numeric:tabular-nums; font-size:0.85rem; }
      .val.zero, .name.zero, .cost.zero, .cost.na, .pct.zero { color: var(--disabled-text-color, #9e9e9e); }
      .cost.na { font-style: italic; }
      .cost .u { font-size:0.75em; }
      .status { padding:10px 4px; color:var(--secondary-text-color); font-size:0.9rem; }
      .status.error { color:var(--error-color, #c62828); }
      .status.warn { color:var(--warning-color, #ff9800); }
    `;
  }
}

// Visual editor: HA's built-in form for every static option, plus a zone list.
// It exists because ha-form cannot render a repeatable list, and zones need an
// area picker (an `object`/text field cannot offer one).
class HierarchyEnergyCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._form = null;
    this._zones = [];
    this._sig = null;
    this._areasSig = null;
    this._shell = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    const sig = Object.keys((hass && hass.areas) || {}).sort().join("|");
    if (sig !== this._areasSig) { this._areasSig = sig; this._paintZones(); }
  }
  get hass() { return this._hass; }

  setConfig(config) {
    this._config = config || {};
    this._zones = HierarchyEnergyCard._normalizeZones(this._config);
    if (!this._shell) this._buildShell();
    this._form.data = this._config;
    const sw = this.shadowRoot.querySelector(".zswitch");
    if (sw) sw.checked = !!this._config.use_virtual_energy_zones;
    // Only rebuild the list when its shape changes, so typing in a zone name
    // does not tear down the focused field.
    const sig = this._zones.map((z) => z.id).join("|");
    if (sig !== this._sig) { this._sig = sig; this._paintZones(); }
  }

  _buildShell() {
    this._shell = true;
    this.shadowRoot.innerHTML =
      "<style>" +
        ":host { display:block; }" +
        ".zones { margin-top:16px; border-top:1px solid var(--divider-color,rgba(127,127,127,0.2)); padding-top:12px; }" +
        ".zhead { font-weight:500; font-size:0.95rem; }" +
        ".zhint { color:var(--secondary-text-color); font-size:0.85rem; margin:4px 0 8px; }" +
        ".ztoggle { display:flex; align-items:center; gap:8px; font-size:0.9rem; margin-bottom:8px; }" +
        ".zone { border:1px solid var(--divider-color,rgba(127,127,127,0.2)); border-radius:6px; padding:8px; margin-bottom:8px; }" +
        ".zr { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }" +
        ".zname { flex:1 1 180px; min-width:0; box-sizing:border-box; padding:14px 12px; font:inherit; color:var(--primary-text-color); background:var(--mdc-text-field-fill-color, rgba(127,127,127,0.12)); border:1px solid var(--divider-color, rgba(127,127,127,0.35)); border-radius:4px; }" +
        ".zname:focus { outline:none; border-color:var(--primary-color); }" +
        ".zicon { flex:0 1 170px; min-width:130px; }" +
        ".zdel { flex:0 0 auto; margin-left:auto; background:none; border:none; color:var(--error-color,#c62828); cursor:pointer; font-size:0.8rem; padding:6px 0; }" +
        ".zareas { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:2px 10px; margin-top:8px; }" +
        ".zarea { display:flex; align-items:center; gap:6px; font-size:0.85rem; cursor:pointer; min-width:0; }" +
        ".zarea span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }" +
        ".zarea input { accent-color:var(--primary-color); margin:0; }" +
        ".zadd { background:none; border:1px solid var(--primary-color); color:var(--primary-color); border-radius:4px; padding:6px 10px; cursor:pointer; font-size:0.85rem; }" +
        ".zempty { color:var(--secondary-text-color); font-size:0.85rem; margin-bottom:8px; }" +
      "</style>" +
      '<div class="form"></div>' +
      '<div class="zones">' +
        '<div class="zhead">Virtual Energy Zones</div>' +
        '<div class="zhint">Group areas into zones that can span floors or floors-plus-extras. ' +
          "Each area belongs to one zone: picking it in another zone moves it there.</div>" +
        '<label class="ztoggle"><ha-switch class="zswitch"></ha-switch><span>Use virtual energy zones</span></label>' +
        '<div class="zlist"></div>' +
        '<button class="zadd">Add zone</button>' +
      "</div>";

    const cfg = HierarchyEnergyCard.getConfigForm();
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = this._config;
    form.schema = cfg.schema;
    if (cfg.computeLabel) form.computeLabel = cfg.computeLabel;
    if (cfg.computeHelper) form.computeHelper = cfg.computeHelper;
    form.addEventListener("value-changed", (ev) => {
      this._config = Object.assign({}, this._config, ev.detail.value);
      this._emit();
    });
    this._form = form;
    this.shadowRoot.querySelector(".form").appendChild(form);

    const sw = this.shadowRoot.querySelector(".zswitch");
    sw.addEventListener("change", () => {
      this._config = Object.assign({}, this._config, { use_virtual_energy_zones: !!sw.checked });
      this._emit();
    });
    this.shadowRoot.querySelector(".zadd").addEventListener("click", () => {
      const used = new Set(this._zones.map((z) => z.id));
      let id = "zone";
      for (let n = 2; used.has(id); n++) id = "zone-" + n;
      this._zones = this._zones.concat([{ id, name: "New zone", icon: null, areas: [] }]);
      this._sig = null;
      this._emit();
    });
  }

  _paintZones() {
    const list = this.shadowRoot && this.shadowRoot.querySelector(".zlist");
    if (!list) return;
    if (!this._zones.length) {
      list.innerHTML = '<div class="zempty">No zones yet.</div>';
      return;
    }
    list.innerHTML = "";
    for (const z of this._zones) {
      // The panel re-normalizes `this._zones` on every config round-trip, so
      // handlers resolve the live object by id instead of closing over this one.
      const cur = () => this._zones.find((x) => x.id === z.id);

      const row = document.createElement("div");
      row.className = "zone";
      const head = document.createElement("div");
      head.className = "zr";

      // Native input: ha-textfield is gone and ha-selector's internal width
      // overflowed the flex row, so the name box ran under the icon picker.
      const name = document.createElement("input");
      name.type = "text";
      name.className = "zname";
      name.placeholder = "Zone name";
      name.value = z.name;
      name.addEventListener("change", () => {
        const c = cur();
        if (!c) return;
        const v = name.value.trim();
        if (!v) { name.value = c.name; return; }
        c.name = v;
        this._emit();
      });
      name.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") name.blur();
      });

      const icon = document.createElement("ha-selector");
      icon.className = "zicon";
      icon.hass = this._hass;
      icon.selector = { icon: {} };
      icon.value = z.icon || "";
      icon.addEventListener("value-changed", (ev) => {
        const c = cur();
        if (!c) return;
        c.icon = ev.detail.value || null;
        this._emit();
      });

      const rm = document.createElement("button");
      rm.className = "zdel";
      rm.textContent = "Remove";
      rm.addEventListener("click", () => {
        this._zones = this._zones.filter((x) => x.id !== z.id);
        this._sig = null;
        this._emit();
      });

      // Plain checkbox list, not ha-selector-area: the area picker renders
      // nothing outside HA's own form context, and we want the move-on-select
      // behaviour to be obvious.
      const areas = document.createElement("div");
      areas.className = "zareas";
      const allAreas = (this._hass && this._hass.areas) || {};
      const areaIds = Object.keys(allAreas).sort((a, b) =>
        String(allAreas[a].name || a).localeCompare(String(allAreas[b].name || b)));
      for (const areaId of areaIds) {
        const lab = document.createElement("label");
        lab.className = "zarea";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = z.areas.indexOf(areaId) !== -1;
        cb.addEventListener("change", () => {
          const c = cur();
          if (!c) return;
          if (cb.checked) {
            c.areas = c.areas.concat([areaId]);
            // Move, don't copy: an area lives in at most one zone.
            for (const other of this._zones) {
              if (other.id !== c.id) other.areas = other.areas.filter((a) => a !== areaId);
            }
          } else {
            c.areas = c.areas.filter((a) => a !== areaId);
          }
          this._paintZones();
          this._emit();
        });
        const txt = document.createElement("span");
        txt.textContent = allAreas[areaId].name || areaId;
        lab.appendChild(cb);
        lab.appendChild(txt);
        areas.appendChild(lab);
      }

      head.appendChild(name);
      head.appendChild(icon);
      head.appendChild(rm);
      row.appendChild(head);
      row.appendChild(areas);
      list.appendChild(row);
    }
  }

  _emit() {
    const zones = this._zones.map((z) => ({
      id: z.id, name: z.name, icon: z.icon || undefined, areas: z.areas.slice()
    }));
    const config = Object.assign({}, this._config, { virtual_energy_zones: zones });
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config }, bubbles: true, composed: true
    }));
  }
}

if (!customElements.get("hierarchy-energy-card")) {
  customElements.define("hierarchy-energy-card", HierarchyEnergyCard);
}
if (!customElements.get("hierarchy-energy-card-editor")) {
  customElements.define("hierarchy-energy-card-editor", HierarchyEnergyCardEditor);
}window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "hierarchy-energy-card")) {
  window.customCards.push({
    type: "hierarchy-energy-card",
    name: "Hierarchy Energy Card",
    description: "Indented energy breakdown by upstream device, with period summary, synced to the Energy date picker.",
    documentationURL: "https://github.com/RenanAz/hierarchy-cards"
  });
}