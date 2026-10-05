# PageSonic

PageSonic is a local-first PDF reader with text-to-speech capabilities built with SolidJS + TypeScript.

## Modernization Status
Active modernization is tracked in `docs/IMPLEMENTATION_BACKLOG.md`.

Current focus:
- Reading UI runtime performance (first-page latency, scroll smoothness, render scheduling)
- In-app performance visualization (settings metrics + optional viewer HUD)
- Pluggable model support architecture (Browser TTS, Piper, Kokoro-ready adapter)

## Feature Implementation Ledger
All feature work is tracked by backlog ID in `docs/IMPLEMENTATION_BACKLOG.md`.

Contributor rule:
1. Pick one backlog ID.
2. Implement that slice.
3. Commit with backlog ID in message.
4. Update ledger status and `PR/Commit` field.

## Current Model Support Matrix
| Engine / Model | Runtime Status | Notes |
| --- | --- | --- |
| Browser TTS (SpeechSynthesis) | Available | System voices; fallback path supported |
| Piper TTS (local ONNX) | Available | Primary local model path in current app |
| Kokoro TTS (local ONNX) | Planned / Experimental | Track via `P0-MDL-004` and related model tasks |

## Performance Visualization Plan
Planned telemetry UX (tracked under `P0-PFV-*`):
- Settings debug metrics panel for session-level performance data.
- Optional viewer HUD overlay for realtime rendering stats.
- Snapshot export for issue triage and benchmark comparisons.

## Core Features
- Local PDF loading and rendering (PDF.js)
- Text extraction for TTS playback
- Local and browser TTS options
- Library and document metadata management
- Cross-origin isolation setup for advanced browser capabilities

## Development
### Prerequisites
- Node.js + npm
- Modern browser with WASM support
- WebGPU-capable browser for future Kokoro/WebGPU paths

### Commands
- `npm run type-check` - TypeScript validation
- `npm run build` - Production build to `dist/`
- `npm run preview` - Serve production build locally
- `npm run dev` - Local dev server (do not run in restricted execution environments)

### Required Validation Before Merge
1. `npm run type-check`
2. `npm run build`

## Architecture Overview
- `src/components/` - UI components and view composition
- `src/stores/` - state and orchestration
- `src/tts/` - model inference runtime and worker
- `src/utils/` - platform, audio, storage, and infra helpers
- `public/` - static worker/runtime/model assets

## Contributor Workflow (Backlog-Driven)
1. Open `docs/IMPLEMENTATION_BACKLOG.md`.
2. Choose the next unblocked item.
3. Implement one feature slice per commit.
4. Update ledger row (`Status`, `PR/Commit`).
5. Repeat.

Recommended commit format:
- `feat(backlog:<ID>): ...`
- `fix(backlog:<ID>): ...`
- `chore(backlog:<ID>): ...`
- `docs(backlog:<ID>): ...`

## Deployment Notes
Production deployment assets and infra definitions are in `infra/`.
- Build app first: `npm run build`
- Deploy: `cd infra && npm install && npm run deploy:site`.
- The domain (`page-sonic.james-ralph.com`) and the shared `*.james-ralph.com` ACM certificate ARN live in `infra/cdk.json` context; the certificate is owned by the portfolio repo's `NextjsPortfoliositeCertificateStack`. The stack refuses to synthesize without them, so a deploy cannot silently strip the custom domain.

## Privacy
PageSonic is designed for local processing:
- PDFs are processed client-side.
- TTS synthesis is local/browser-side.
- No mandatory cloud processing pipeline.
