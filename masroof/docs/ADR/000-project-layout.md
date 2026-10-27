# ADR-000: Project location, layout and package manager

- Status: Accepted (Phase 0)
- Date: 2026-10-15

## Context

The repository already holds an unrelated Python project (`xrp_forecast/`) and a stock Expo template (`mobile/`). The spec puts Expo Router screens in `app/` and code under `src/`, and asks for pnpm.

## Decision

- Masroof lives in its own folder, `masroof/`, so it can't break the existing projects and can move to its own repo later with `git subtree split`.
- Inside it, the layout follows spec §3: `app/` (routes), `src/{domain,data,services,features,ui,i18n}`, `tests/`, `e2e/`, `docs/`.
- pnpm with `node-linker=hoisted` (`.npmrc`). Metro and React Native autolinking expect a flat `node_modules`.
- Expo SDK 58 (latest stable on 2026-10-15), React Native 0.88, TypeScript 6 in strict mode, plus `noUncheckedIndexedAccess`.
- Layering (`ui → features → services → domain ← data`) is enforced by `no-restricted-imports` rules in `eslint.config.js`, not just by convention.

## Consequences

- CI runs only on changes under `masroof/` (paths filter).
- Husky is installed at the repository root with `core.hooksPath=masroof/.husky/_`. The hook does nothing unless staged files are under `masroof/`.
- `mobile/` is left untouched. Delete it if it was only a placeholder (see OPEN_QUESTIONS Q1).
