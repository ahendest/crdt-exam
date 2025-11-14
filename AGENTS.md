# Agent Guidelines

This repository is organized as a Node.js workspace containing three packages:

- `server/` — the Yjs WebSocket sync server
- `client/` — the React browser client
- `robots/` — headless editors used for automated scenarios

## Coding Conventions
- Prefer TypeScript strictness when touching `server/` or `robots/`; avoid implicit `any`.
- Keep React components in `client/` function-based and colocate CSS modules with components when styling changes are needed.
- Do not introduce `try/catch` around imports; rely on module resolution errors to surface during builds.

## Development Commands
- Install dependencies once from the repo root: `npm install`.
- Use workspace-aware npm scripts (e.g., `npm run dev --workspace server`) to run package-specific tasks.
- Run unit or integration tests that apply to the package you modify before opening a pull request.

## Documentation
- Update `README.md` whenever you add or change developer workflows (commands, configuration, startup steps).
- When adding new folders with specific conventions, include an `AGENTS.md` inside that folder to describe the expectations.

## Pull Requests
- Summaries should call out user-visible behaviour changes first, followed by internal refactors.
- Include links to relevant sections of the documentation whenever you change onboarding steps.
