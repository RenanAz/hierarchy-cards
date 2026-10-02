# Pull requests

- One logical change per PR.
- `src/` and the rebuilt `dist/` in the same commit (`npm run build`).
- Update `CHANGELOG.md` under `[Unreleased]`.
- Describe the previous behaviour and why it changes.
- The `Validate` workflow (HACS action) must pass.

## Checklist

- [ ] Edited `src/`, not `dist/`
- [ ] Ran `npm run build`
- [ ] `CHANGELOG.md` updated
- [ ] Tested on a real dashboard (paste the card config you used)
