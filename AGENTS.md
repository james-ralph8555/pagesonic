# Repository Guidelines

## Project Structure & Module Organization
- `src/`: SolidJS + TypeScript source.
  - `src/components/`: UI components (PascalCase files, e.g., `PDFViewer.tsx`).
  - `src/stores/`: state containers (e.g., `pdf.ts`, `tts.ts`), exported via `useX` hooks.
  - `src/utils/`, `src/types/`, `src/hooks/`: helpers, type defs, and hooks.
- `public/`: static assets bundled as-is (`pdf.worker.min.js`, `ort/*`, `models/*`).
- `index.html`: app entry; `dist/`: build output.
- `vite.config.ts`: Vite config with `@` alias to `src/` and COOP/COEP headers.

## Build, Test, and Development Commands
- DO NOT RUN NPM DEV.
- `npm run dev`: start Vite dev server at `http://localhost:3000` — DO NOT RUN in this environment.
- `npm run build`: production build to `dist/` with manual chunks.
- `npm run preview`: serve the built app for local verification.
- `npm run type-check`: run `tsc --noEmit` with strict settings.
- `npm test`: placeholder (no test runner configured yet).

## Coding Style & Naming Conventions
- Language: TypeScript with SolidJS (`.tsx` for components, `.ts` elsewhere).
- Imports: prefer `@/path` alias for sources; relative paths for siblings.
- Naming: PascalCase components, camelCase functions/variables, `useX` for stores.
- Formatting: follow existing style (2-space indent, single quotes, minimal semicolons). No linter is configured; keep diffs small and consistent.

## Testing Guidelines
- Framework: not set up. If adding tests, prefer Vitest + `@solidjs/testing-library`.
- Location: colocate as `Component.test.tsx` next to source or under `src/__tests__/`.
- Coverage: target critical paths in `src/stores/` and rendering of key components.
- Running: define "test" in `package.json` (e.g., `vitest run`) and document in PR.

## Commit & Pull Request Guidelines
- Commits: short, present-tense summaries (e.g., `add pdf selection context`). Optional scope prefix (`viewer:`) when helpful.
- PRs must include:
  - Clear description and rationale; link issues.
  - Screenshots/GIFs for UI changes.
  - Checklist: `npm run type-check`, `npm run build`, verify with `npm run preview`.
  - Note breaking changes and update docs where relevant.

## Security & Configuration Tips
- Models and ORT binaries are served from `public/`. Keep paths stable (`/models/*.onnx`).
- WebGPU: Kokoro requires WebGPU; app sets COOP/COEP headers for advanced features.
- Avoid adding secrets; this is a static client app.
