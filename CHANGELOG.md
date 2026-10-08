# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Per-row cost column on the energy card (`show_cost`, `cost_width`,
  `cost_decimals`, `cost_show_currency`): each row shows its pro-rata share of
  the period cost the `Cost` chip reports.
- `date_picker: auto|always|never` on the energy card: it now mounts the
  built-in `energy-date-selection` itself when the dashboard has none, instead
  of showing zeros. `ebc6b38`

### Changed
- Cards size to their content: the `.card-content` 660 px scroll cap is gone,
  and `getCardSize()` is computed from the visible row count. `5b38c2b`, `6e7c9a0`

### Fixed
- Removed hard-coded personal tariff sensors/prices from the energy card
  defaults; cost and tariff chips are now opt-in. `eb1a2ee`

## [0.1.0] - 2026-10-02

### Added
- Imported the original `hierarchy-power-card` and `hierarchy-energy-card`
  inline sources as the baseline, exactly as they ran on the author's instance.
  `763e960`
- Repository scaffolding: `build.mjs`, `hacs.json`, `package.json`, MIT license,
  HACS validation and release workflows.
