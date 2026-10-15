# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security
- Validate the `label_width` / `value_width` / `percent_width` / `cost_width`
  options before interpolating them into the card stylesheet. Invalid or
  crafted values now fall back to their defaults instead of being injected
  verbatim (`calc()` / `var()` expressions still pass).

## [1.1.0] - 2026-10-15

### Added
- Gas chip on the energy card (`show_gas`, `gas_label`), mirroring the water
  chip.
- `chip_io_style` option (`arrows` | `words`) for the Grid and Battery chips on
  both cards.

### Changed
- `cost_width` moved next to the other column widths in the **Visual** panel;
  the cost display options now note they need **Show cost column** enabled.
- Tariff chip: the `tariff_show_percent` toggle is replaced by
  `tariff_display` (`values` | `percent` | `both`), and `tariff_peak_first`
  flips the chip to peak-before-off-peak. The old boolean is still read for
  back-compat.
- Summary chip values render slightly smaller, and their unit suffixes smaller
  still.
- Battery charge/discharge text is coloured — charging "in" is blue, draining
  "out" is amber (no green/red).

## [1.0.0] - 2026-10-15

### Added
- **Visual config editor** for both cards, via HA's built-in form editor
  (`getConfigForm`) plus `getStubConfig`. Options are grouped into Content /
  Tree / Ordering / Visual / Summary chips / Cost column / Cost sources /
  Advanced panels (power: Content / Tree / Ordering / Visual / Summary /
  Advanced). Keys not shown in the form are preserved, so hand-written YAML
  keeps working.
- `cost.zero_cost_entities` on the energy card: list entities (solar-served
  loads) that are excluded from the cost allocation and shown as `–` (en dash)
  in the cost column, so they no longer skew the per-kWh rate applied to the
  grid-billed lines.
- **`first_level_sort_by` / `area_sort_by` / `entity_sort_by`** options
  (`name` | `kwh` | `cost` | `tree`) replace `sort_siblings`. One per hierarchy
  level: level-1 roots, area group rows, and entities inside an area; `cost` is
  energy-only (the power card falls back to `kwh`). Zero rows always sink to the
  bottom. Defaults: `first_level_sort_by: tree`, `area_sort_by: name`,
  `entity_sort_by: kwh`.
- Rows that display as zero fade to the disabled grey (name, value, and cost on
  the energy card; name, value and percentage on the power card; the percentage
  cell also fades on the energy card).
- Per-row cost column on the energy card (`show_cost`, `cost_width`,
  `cost_decimals`, `cost_show_currency`): each row shows its pro-rata share of
  the period cost the `Cost` chip reports.
- `date_picker: auto|always|never` on the energy card: it now mounts the
  built-in `energy-date-selection` itself when the dashboard has none, instead
  of showing zeros. `ebc6b38`

### Removed
- `grid_battery_estimate` (energy): the `min(battery charge, grid import)`
  heuristic did not represent real grid→battery flow (it ignored solar charging
  and load draw). The "Grid to Batt" chip now requires an explicit
  `grid_battery_entity` and is hidden when unset.

### Changed
- Config-editor hints moved from below each field to a short description under
  each panel title, above the options.
- Editor options regrouped by what they affect: `show_summary` and
  `grid_show_out` moved into **Summary chips**, `max_rows` into **Tree**,
  `date_picker` into **Advanced**, and the cost display fields
  (`show_cost`, `cost_width`, `cost_decimals`, `cost_show_currency`) into a
  **Cost column** panel. `cost.unit` is now labelled **Currency symbol** to
  distinguish it from the display `unit`.
- Tariff band labels default to English `Off-peak` / `Peak` instead of the
  Portugal-specific `Vazio` / `Fora`; both remain renameable per card.
- Bars now use a colour ramp by tree depth: a zone's palette hue is reused but
  faded per level (`alpha = max(0.30, 1 − depth × 0.25)`), so hierarchy reads at
  a glance while the hue still identifies the zone branch. Alpha blends against
  the card/track, so it works on light and dark themes.
- Unit suffixes on both cards (kWh, W and €) render smaller than the value, so
  the number stays the visual anchor.
- Cards size to their content: the `.card-content` 660 px scroll cap is gone,
  and `getCardSize()` is computed from the visible row count. `5b38c2b`, `6e7c9a0`

### Fixed
- `suppress_parent_area` ("Hide parent's own area") no longer suppresses the
  top-level area group. It now only hides an area bucket when the parent row is
  already inside an area group of that same area, so the first level of area
  grouping stays visible and only the nested duplicate is removed (energy and
  power).
- Tariff off-peak / peak labels (`tariff_offpeak_label`, `tariff_peak_label`) are
  now shown on the visible tariff chip; previously they only appeared in the
  hover tooltip, so editing them had no visible effect.
- Grid chip no longer appends the redundant `in` qualifier when grid export is
  hidden (energy) or off (power); it then shows just the import figure.
- Percentage column width is now reserved on every row, so a row whose share is
  undefined (e.g. the only child of a zero-total area) no longer lets its bar
  grow into the percentage column. Such rows show `0%` when the value is zero.
- Removed hard-coded personal tariff sensors/prices from the energy card
  defaults; cost and tariff chips are now opt-in. `eb1a2ee`

## [0.1.0] - 2026-10-02

### Added
- Imported the original `hierarchy-power-card` and `hierarchy-energy-card`
  inline sources as the baseline, exactly as they ran on the author's instance.
  `763e960`
- Repository scaffolding: `build.mjs`, `hacs.json`, `package.json`, MIT license,
  HACS validation and release workflows.
