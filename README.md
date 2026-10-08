# Hierarchy Power & Energy Cards

Indented, collapsible breakdowns of your **live power** and **energy** by
upstream device, with optional grouping by Home Assistant area.

Two Lovelace custom cards, built from your existing **Energy dashboard**
configuration — no extra sensors or templates required.

> [!WARNING]
> **Status: pre-release / unreleased.** The cards are imported from a working
> personal setup and track its code exactly; nothing has been published yet.
> The energy card mounts its own date picker, but the other items in
> [Known limitations](#known-limitations) are real. Read
> [Before you publish](#before-you-publish) before cutting a release.

---

## History

`763e960` is the imported baseline — the cards exactly as they ran before this
repository existed. Everything above it is a reviewable change:

| Commit | Change |
|--------|--------|
| `5b38c2b` | removed the 660 px inner scroll cap |
| `6e7c9a0` | `getCardSize()` computed from visible rows |
| `eb1a2ee` | dropped hard-coded personal tariff defaults |
| `ebc6b38` | energy card mounts its own `energy-date-selection` |

`git diff 763e960..HEAD` is the full delta from the original code.

---

## Cards

| Card | Element | What it shows |
|------|---------|---------------|
| Hierarchy Power | `custom:hierarchy-power-card` | Instantaneous power (W) per device, nested by "included in" parent, plus grid / solar / battery summary chips. |
| Hierarchy Energy | `custom:hierarchy-energy-card` | Energy (kWh) per device for the period selected in the Energy date picker, plus cost / tariff / water summary chips. |

Both cards render an indented tree with a proportional bar per row, a
`Untracked` row for the parent-minus-children remainder, expand/collapse
(remembered in `localStorage`), and tap-to-open-more-info.

<!-- Add screenshots to docs/ and reference them here, e.g.
![Power card](docs/power.png) -->

---

## Requirements

- Home Assistant **2024.11 or newer** (Sections view / `energy/get_prefs`).
- The **Energy dashboard must be configured** (Settings → Dashboards → Energy).
  Both cards read `energy/get_prefs`; the device hierarchy comes from each
  device's **"Included in"** (`included_in_stat`) setting.
- For the Energy card, no separate selector is required: the card mounts the
  built-in one automatically (`date_picker: auto`). See
  [The Energy card and the date picker](#the-energy-card-and-the-date-picker).
- The logged-in user must be an **administrator** (`energy/get_prefs` is
  admin-only).

---

## Installation

### HACS (recommended)

1. HACS → **Frontend** → ⋮ → **Custom repositories**.
2. Add this repository's URL, category **Dashboard**.
3. Install **Hierarchy Power & Energy Cards**.
4. Reload the browser (hard refresh).

HACS registers the resource automatically. If it does not, add it manually:

```yaml
# Settings → Dashboards → Resources
url: /hacsfiles/hierarchy-cards/hierarchy-cards.js
type: module
```

### Manual

1. Download `dist/hierarchy-cards.js` into `/config/www/`.
2. Add a resource pointing at `/local/hierarchy-cards.js` with type `module`.
3. Hard refresh (Ctrl/Cmd+Shift+R).

---

## Quick start

```yaml
type: sections
sections:
  - type: grid
    cards:
      - type: heading
        heading: Live power
      - type: custom:hierarchy-power-card
        title: Live Power
        unit: W
        group_by_area: true

  - type: grid
    cards:
      - type: heading
        heading: Energy
      # REQUIRED for the Energy card: gives it the selected date range.
      - type: energy-date-selection
        disable_compare: true
      - type: custom:hierarchy-energy-card
        title: Consumption by Zone
        unit: kWh
        group_by_area: true
```

---

## The Energy card and the date picker

By default (`date_picker: auto`) the card **mounts its own built-in
`energy-date-selection` picker** when the dashboard doesn't already have one.
So you do **not** have to add a selector card yourself.

- `date_picker: auto` (default) — add a picker only if none is present on the
  dashboard and no Energy collection is being shared.
- `date_picker: always` — always render one (e.g. to keep the control inside the
  card).
- `date_picker: never` — never render one; you supply a standalone
  `energy-date-selection` card.

If neither your dashboard nor the card can produce a selector (rare — it needs
Lovelace's card helpers), the card shows a hint instead of silent zeros.

> The card still *follows* a standalone `energy-date-selection` when one exists,
> so a single picker can drive several cards. A future release will add a
> self-contained Today / Week / Month range so the picker is not required at all.

---

## Configuration

### `custom:hierarchy-power-card`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | `Live Power` | Card header. |
| `unit` | string | `W` | Display unit. `W`, `kW` or `MW` (values are converted for display only). |
| `id` | string | title | Stable key used to remember expanded/collapsed rows in `localStorage`. Set it if you use two power cards with the same title. |
| `show_summary` | bool | `true` | Show the summary chips (Total / Grid / Solar / Battery / SOC). |
| `group_by_area` | bool | `false` | Group a device's children into collapsible area buckets. |
| `suppress_parent_area` | bool | `true` | When grouping by area, don't create a bucket for the parent's own area (avoids echoing the parent). |
| `show_untracked` | bool | `true` | Show the "parent minus children" remainder row. |
| `untracked_label` | string | `Untracked` | Label for that row. |
| `no_area_label` | string | `No area` | Label for devices without an area. |
| `bar_scale` | string | `parent` | Bar length basis: `parent` (share of parent), `total` (share of grand total), `global` (share of largest row). |
| `show_percent` | bool \| string | `false` | Show the percentage column: `true`/`all`, `areas`, `devices`, or `false`. |
| `sort_siblings` | string | `tree` | `tree` (Energy-dashboard order) or `value` (largest first). |
| `expanded_by_default` | bool | `true` | Expand device groups on first load. |
| `expand_areas_by_default` | bool | `false` | Also expand area buckets on first load. |
| `hide_zero` | bool | `false` | Hide rows at or below `zero_threshold`. |
| `zero_threshold` | number | `0` | Threshold used by `hide_zero`. |
| `update_interval` | number | `1` | Minimum seconds between re-renders, to tame noisy power sensors. |
| `max_rows` | number | `300` | Hard cap on rendered rows. |
| `label_width` | string | `30%` | CSS width of the name column. |
| `value_width` | string | `68px` | CSS width of the value column. |
| `percent_width` | string | `34px` | CSS width of the percentage column. |
| `hide_unit_label` | bool | `false` | Hide the unit suffix next to values. |
| `grid_show_out` | bool | `true` | Show grid **export** as well as import in the Grid chip. |

### `custom:hierarchy-energy-card`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | `Consumption by Zone` | Card header. |
| `unit` | string | `kWh` | Display unit. `kWh`, `Wh` or `MWh` (converted for display). |
| `id` | string | title | Stable key for remembering expanded/collapsed rows. |
| `show_summary` | bool | `true` | Show summary chips. |
| `group_by_area` | bool | `false` | Group children into collapsible area buckets. |
| `suppress_parent_area` | bool | `true` | Don't create a bucket for the parent's own area. |
| `show_untracked` | bool | `true` | Show the remainder row. |
| `untracked_label` | string | `Untracked` | Label for that row. |
| `no_area_label` | string | `No area` | Label for devices without an area. |
| `bar_scale` | string | `global` | `parent`, `total` or `global`. |
| `show_percent` | bool \| string | `false` | `true`/`all`, `areas`, `devices`, or `false`. |
| `sort_siblings` | string | `tree` | `tree` or `value`. |
| `expanded_by_default` | bool | `true` | Expand device groups initially. |
| `expand_areas_by_default` | bool | `false` | Also expand area buckets initially. |
| `max_rows` | number | `300` | Row cap. |
| `label_width` / `value_width` / `percent_width` | string | `30%` / `68px` / `34px` | Column widths. |
| `hide_unit_label` | bool | `false` | Hide the unit suffix. |
| `show_cost` | bool | `false` | Show a per-row cost column (pro-rata share of the period cost the `Cost` chip shows). |
| `cost_width` | string | `62px` | CSS width of the cost column. |
| `cost_decimals` | number | `2` | Decimals shown in the cost column. |
| `cost_show_currency` | bool | `true` | Append the `cost.unit` symbol to each cost value. |
| `show_tariff` | bool | `false` | Show the off-peak / peak split chip (needs `cost` entities). |
| `tariff_offpeak_label` | string | `Vazio` | Off-peak label. |
| `tariff_peak_label` | string | `Fora` | Peak label. |
| `tariff_decimals` | number | `1` | Decimals in the tariff chip. |
| `tariff_show_percent` | bool | `true` | Show each tariff band's percentage. |
| `show_grid_battery` | bool | `true` | Show the "Grid to Batt" chip. |
| `grid_battery_entity` | string \| null | `null` | A real grid→battery energy sensor. If unset and `grid_battery_estimate` is on, it is estimated as `min(battery charge, grid import)`. |
| `grid_battery_estimate` | bool | `true` | Allow the estimate when no entity is set. |
| `grid_battery_label` | string | `Grid to Batt` | Chip label. |
| `show_water` | bool | `true` | Show the water chip when the Energy dashboard has water. |
| `water_label` | string | `Water` | Water chip label. |
| `date_picker` | string | `auto` | `auto` mounts a built-in `energy-date-selection` when none is present; `always`; `never`. |
| `cost.peak_entity` | string \| null | `null` | Energy sensor for the peak tariff period. |
| `cost.offpeak_entity` | string \| null | `null` | Energy sensor for the off-peak period. |
| `cost.peak_price` | number | `0` | Price per unit for the peak period. |
| `cost.offpeak_price` | number | `0` | Price per unit for the off-peak period. |
| `cost.unit` | string | `€` | Currency symbol. |
| `cost.zero_cost_entities` | list | `[]` | Statistic/entity ids treated as zero cost (e.g. solar-served EV, hot water). Excluded from the cost allocation and shown as €0. Marking a parent zeroes its whole subtree. |

Cost and tariff chips appear only when at least one of
`cost.peak_entity` / `cost.offpeak_entity` is set.

```yaml
type: custom:hierarchy-energy-card
title: Consumption by Zone
unit: kWh
group_by_area: true
bar_scale: parent
show_percent: areas
show_tariff: true
cost:
  peak_entity: sensor.energy_consumption_peak
  offpeak_entity: sensor.energy_consumption_offpeak
  peak_price: 0.23
  offpeak_price: 0.12
  unit: €
  # Solar-served loads: free, and removed from the cost allocation base so they
  # don't dilute the rate charged to the grid-billed lines.
  zero_cost_entities:
    - sensor.ev_charger_energy
    - sensor.hot_water_energy
```

---

## How it works

- Both cards call `energy/get_prefs` to read the Energy dashboard's
  `device_consumption` entries and `energy_sources`, then build a parent/child
  tree from each entry's `included_in_stat`.
- **Power** reads live states (`hass.states`) and refreshes on every state
  update (throttled by `update_interval`).
- **Energy** calls `recorder/statistics_during_period` with `types: ["change"]`
  for the selected range, sums each statistic, and normalises the unit.
- When `show_cost` is on, each row's cost is the period cost (the same value as
  the `Cost` chip) allocated pro-rata by **grid-billed energy**. Rows whose
  entity is listed in `cost.zero_cost_entities` (solar-served loads) are free
  and are removed from the allocation base, so they neither show a cost nor
  dilute the rate applied to the remaining lines. Children plus `Untracked`
  still sum to the parent, and the root rows sum exactly to the chip.
- Area grouping uses `hass.entities` / `hass.devices` / `hass.areas`.
- Boilerplate (colours, escaping, formatting, tree building, area lookup) is
  currently duplicated between the two source files; see the roadmap.

---

## Known limitations

These are the reasons this is pre-release rather than release-ready:

1. **Energy card depends on HA-internal state.** It locates the Energy panel's
   date-selection collection by scanning private keys on `hass.connection`
   (`_energy*`) and subscribes to it. This is undocumented and may break
   between Home Assistant releases.
2. **Energy card has no range engine of its own.** `date_picker: auto` mounts
   the built-in picker, so a standalone selector card is no longer required —
   but the card still cannot set a period by itself. A fully self-contained
   Today / Week / Month range is on the roadmap.
3. **Admin-only.** `energy/get_prefs` fails for non-admin users; the card shows
   an error message instead of degrading.
4. **Polling.** The Energy card polls the collection every 500 ms while mounted.
5. **No GUI editor.** There is no `getConfigElement` / `getConfigForm`, and no
   `getStubConfig`, so the card picker/YAML editor can't help configure it.
6. **Partial localisation.** Several strings are hard-coded English
   ("Total", "Untracked", "Collapse all", …) and the `Vazio`/`Fora` tariff
   labels are Portugal-specific defaults.
7. **`hide_zero` / `zero_threshold` are inert on the Energy card.** They are
   referenced in `getCardSize()` but not applied by the render path.
8. **Flat tree without hierarchy.** The tree only nests if you set
   "Included in" on your Energy devices; otherwise all devices are roots.
9. **No tests / no bundler.** The build is a plain concatenation and there is
   no automated test suite.

## Roadmap

- [x] Mount the built-in Energy date picker when the dashboard has none
      (`date_picker`). `ebc6b38`
- [x] Size to content instead of a fixed 660 px box. `5b38c2b`, `6e7c9a0`
- [ ] Give the Energy card its own date range (Today / Week / Month / custom)
      with the picker as an optional override.
- [ ] Let config values be entity IDs, so users can point the card at their own
      `input_number` / `utility_meter` / `min_max` helpers.
- [ ] Add explicit `total`/`grid`/`solar`/`battery`/`soc` source overrides and a
      manual `devices:` list, for users who don't use the Energy dashboard.
- [ ] Extract shared code into `src/shared.js` and switch the build to esbuild.
- [ ] Add a visual config editor + `getStubConfig()`.
- [ ] Replace the internal-collection scan with a supported data path (or a
      clearly documented fallback).
- [ ] Handle non-admin users gracefully.
- [ ] Wire up `hide_zero` / `zero_threshold` on the Energy card.
- [ ] Localise all strings.
- [ ] Add a smoke test / CI.

## Before you publish

- [x] **Repository named `hierarchy-cards`** — created at
      [RenanAz/hierarchy-cards](https://github.com/RenanAz/hierarchy-cards).
      HACS requires a `.js` file whose name matches the repository — here,
      `dist/hierarchy-cards.js` — and `filename` in `hacs.json` matches it.
- [x] `LICENSE` copyright and the `package.json` repository URL filled in.
- [ ] Add screenshots and reference them in this README.
- [ ] Set the GitHub repo **description** and **topics** (`home-assistant`,
      `lovelace`, `hacs`, `custom-card`, `energy`). The `Validate` workflow's
      `description` and `topics` checks fail until this is done.
- [ ] Tag and publish a release (`v0.1.0`); HACS reads *releases*, not just tags.
- [ ] Decide whether to do the roadmap refactors before requesting inclusion in
      the default HACS store.

## Development

```bash
npm run build          # regenerates dist/hierarchy-cards.js
```

Test without publishing by copying `dist/hierarchy-cards.js` to
`/config/www/`, adding a resource, and hard-refreshing — or paste it into an
inline dashboard resource (how these cards started).

## License

[MIT](LICENSE).
