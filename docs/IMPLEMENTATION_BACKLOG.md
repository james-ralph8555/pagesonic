# PageSonic Modernization Backlog (Codex 5.3 Standard)

## Summary
This file is the implementation source of truth for modernizing PageSonic with emphasis on:
- reading UI runtime performance,
- performance visualization inside the app,
- robust model support architecture,
- reliability and maintainability upgrades.

The ledger below is intentionally granular so an implementation agent can execute it one slice at a time.

## Current Risk Profile
- PDF loading does expensive work up front and can delay first useful paint.
- Render/scroll logic is distributed across large components and hard to tune safely.
- TTS routing mixes platform checks with model selection state.
- Debug/perf data is noisy but not normalized into actionable telemetry.
- Test/CI coverage for regressions is minimal.

## Backlog Workflow
1. Pick the next `planned` item with all dependencies satisfied.
2. Implement only that item scope.
3. Run validation (`npm run type-check`, `npm run build`, plus tests if present).
4. Stop and perform user verification handshake in Charm Crush:
- ask the user how they want to test this feature in browser,
- provide a feature-specific browser test checklist and expected results,
- wait for user feedback before moving to the next backlog ID (unless user explicitly waives).
5. Commit using backlog ID in commit message.
6. Update this file in the same PR:
- set `Status` to `done` or `blocked`,
- set `PR/Commit` to commit hash,
- update dependency notes if needed.

## Status Definitions
- `planned`: not started.
- `in_progress`: currently being implemented.
- `done`: accepted and merged.
- `blocked`: cannot proceed due to dependency/product decision.

## Feature Ledger
| ID | Feature | Priority | Scope | Status | PR/Commit | Owner | Acceptance Criteria | Dependencies |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DOC-001 | Add modernization backlog + ledger | P0 | Create this file as project execution source of truth | done | 4a8acff | coding-agent | Backlog exists with prioritized, commit-trackable tasks | None |
| DOC-002 | Rewrite README for modernization workflow | P0 | Replace stale README sections with current roadmap and matrix | done | 81d723e | coding-agent | README links backlog and shows model/status matrix | DOC-001 |
| DOC-003 | Replace AGENTS operational guide | P0 | New repo-owned implementation guide with quality gates | done | f49989f | coding-agent | New AGENTS specifies workflow + commands + commit format | DOC-001 |
| DOC-004 | Remove legacy unofficial docs | P0 | Delete stale assistant-specific instruction docs | done | b11bc37 | coding-agent | `CLAUDE.md` removed from repo | DOC-001 |
| DOC-005 | Add Charm Crush verification-first protocol | P0 | Require stop/ask/provide-browser-test flow per feature slice | done | 867fb6b | coding-agent | Agent asks user how to test and provides browser checklist before next feature | DOC-003 |
| P0-RDR-001 | Staged PDF load pipeline | P0 | Load metadata/first page first; defer full extraction | done | e2004c8 | coding-agent | First page renders before full text extraction completion | None |
| P0-RDR-002 | Background extraction priority queue | P0 | Extract text by viewport proximity then remainder | done | pending | coding-agent | Extraction order follows active viewport priorities | P0-RDR-001 |
| P0-RDR-003 | Render scheduler module | P0 | Centralize visible/nearby/offscreen page scheduling | planned | pending | coding-agent | Single authoritative queue controls page renders | P0-RDR-001 |
| P0-RDR-004 | Visibility controller refactor | P0 | Unify IO + scroll seeding into one controller | planned | pending | coding-agent | No duplicate visibility authority paths remain | P0-RDR-003 |
| P0-RDR-005 | Adaptive render concurrency | P0 | Concurrency adjusts by device/runtime pressure | planned | pending | coding-agent | No sustained jank spikes from over-rendering | P0-RDR-003 |
| P0-RDR-006 | Deterministic render cancellation state machine | P0 | Robust cancel/replace behavior for `PDFPage` tasks | planned | pending | coding-agent | No stale page paint after rapid zoom/scroll | P0-RDR-003 |
| P0-RDR-007 | Hot-path logging reduction | P0 | Replace noisy `console.*` in render/audio/tts loops | planned | pending | coding-agent | Release mode avoids console spam in hot loops | None |
| P0-RDR-008 | Canvas memory guardrails | P0 | Limit retained raster surfaces and reclaim memory | planned | pending | coding-agent | Memory usage plateaus under long scroll sessions | P0-RDR-003 |
| P0-RDR-009 | Mobile low-power render mode | P0 | Reduced expensive visual effects + conservative prefetch | planned | pending | coding-agent | Mobile mode maintains responsiveness on mid-tier devices | P0-RDR-003 |
| P0-RDR-010 | Reader perf baseline harness | P0 | Script/utility to compare key metrics across commits | planned | pending | coding-agent | Baseline report generated and stored for regression checks | P0-RDR-001 |
| P0-PFV-001 | Telemetry schema + store | P0 | Typed perf event pipeline and ring buffer snapshots | done | 53a6f14 | coding-agent | Unified telemetry API with typed event catalog | None |
| P0-PFV-002 | PDF metrics instrumentation | P0 | Capture load/render/frame/queue timing events | planned | pending | coding-agent | p50/p95 render metrics visible in snapshots | P0-PFV-001 |
| P0-PFV-003 | TTS metrics instrumentation | P0 | Capture model init, synth latency, playback continuity | planned | pending | coding-agent | TTS pipeline timings visible per session | P0-PFV-001 |
| P0-PFV-004 | Settings perf dashboard | P0 | Add metrics table/charts to debug settings area | planned | pending | coding-agent | User can inspect current + recent perf metrics | P0-PFV-002 |
| P0-PFV-005 | Optional in-viewer perf HUD | P0 | Toggleable reading overlay with realtime perf indicators | planned | pending | coding-agent | HUD can be turned on/off and persisted per user setting | P0-PFV-002 |
| P0-PFV-006 | Telemetry export JSON | P0 | Export snapshot for issue triage and benchmark history | planned | pending | coding-agent | One-click export contains structured metrics schema | P0-PFV-001 |
| P0-MDL-001 | Model registry interface | P0 | Descriptor-based engine/model registration | planned | pending | coding-agent | New model integration requires descriptor only | None |
| P0-MDL-002 | Browser Speech adapter | P0 | Wrap browser engine under registry contract | planned | pending | coding-agent | Browser adapter passes init/speak/pause/resume checks | P0-MDL-001 |
| P0-MDL-003 | Piper adapter | P0 | Wrap Piper runtime under registry contract | planned | pending | coding-agent | Piper adapter uses same lifecycle interface as browser | P0-MDL-001 |
| P0-MDL-004 | Kokoro adapter scaffold | P0 | Feature-flagged adapter with capability checks | planned | pending | coding-agent | Kokoro descriptor exists with guarded activation | P0-MDL-001 |
| P0-MDL-005 | Deterministic engine routing | P0 | `speak()` routes by selected engine/model, not platform branch | planned | pending | coding-agent | Active model selection always matches synthesis path | P0-MDL-001 |
| P0-MDL-006 | Capability matrix evaluation | P0 | Evaluate WebGPU/COI/thread/audio constraints once and cache | planned | pending | coding-agent | UI compatibility badges derive from matrix data | P0-MDL-001 |
| P0-MDL-007 | Fallback policy engine | P0 | Ordered fallback chain with user-facing reasons | planned | pending | coding-agent | Failed model routes to valid fallback with explicit status | P0-MDL-005 |
| P0-MDL-008 | Model lifecycle state machine | P0 | `idle/loading/ready/error/degraded` per model | planned | pending | coding-agent | Lifecycle transitions are typed and observable in UI | P0-MDL-001 |
| P0-MDL-009 | Asset manifest validation | P0 | Preflight model assets before activation | planned | pending | coding-agent | Missing assets fail fast with remediation hint | P0-MDL-001 |
| P0-MDL-010 | Model-switch reliability tests | P0 | Verify switch behavior during idle and active playback | planned | pending | coding-agent | Switching models no longer causes inconsistent store state | P0-MDL-005 |
| P1-ARC-001 | Split `PDFViewer` into smaller components | P1 | Extract rail/menu/navigation/hud sections | planned | pending | coding-agent | `PDFViewer.tsx` is decomposed with clear responsibilities | P0-RDR-003 |
| P1-ARC-002 | Extract viewport/render hooks | P1 | Move scroll/visibility logic into reusable hooks | planned | pending | coding-agent | Hooks encapsulate behavior with unit-testable API | P1-ARC-001 |
| P1-ARC-003 | Audio runtime manager abstraction | P1 | Replace ad hoc global singleton wiring with managed runtime | planned | pending | coding-agent | TTS runtime uses one explicit manager contract | P0-MDL-005 |
| P1-ARC-004 | Error taxonomy normalization | P1 | Strongly typed domain errors with standardized user messages | planned | pending | coding-agent | Errors are mapped consistently across PDF/TTS/Library flows | None |
| P1-ARC-005 | Feature-flag system | P1 | Controlled rollout toggles for perf HUD/model adapters | planned | pending | coding-agent | Flags can enable/disable experimental slices safely | None |
| P1-ARC-006 | Stable app event bus for cross-cutting telemetry | P1 | Replace ad-hoc event wiring with typed bus | planned | pending | coding-agent | Cross-module events are typed and centrally observable | P0-PFV-001 |
| P1-LIB-001 | Leader-election state sync simplification | P1 | Reduce complex fallback paths and duplicate sync logic | planned | pending | coding-agent | Library leadership state becomes deterministic | None |
| P1-LIB-002 | Import cancellation + resume support | P1 | Allow abort/resume for large imports | planned | pending | coding-agent | User can cancel and resume import without corruption | None |
| P1-LIB-003 | Import pipeline backpressure | P1 | Control file processing concurrency by device/storage pressure | planned | pending | coding-agent | Import remains responsive for large batches | P1-LIB-002 |
| P1-LIB-004 | Dev-only debug controls gating | P1 | Hide destructive/diagnostic controls outside dev mode | planned | pending | coding-agent | Production UI excludes internal debug-only controls | None |
| P1-LIB-005 | Optimistic metadata edit with rollback | P1 | Immediate UI update with conflict/error rollback | planned | pending | coding-agent | Metadata edits feel instant and recover cleanly on error | None |
| P1-LIB-006 | Storage quota preflight warnings | P1 | Warn before import when quota risk is high | planned | pending | coding-agent | User receives actionable storage warnings before failure | None |
| P1-QA-001 | Add Vitest test harness | P1 | Introduce test runner and base config | done | 5e7f226 | coding-agent | `npm test` runs meaningful suite | None |
| P1-QA-002 | Store tests for PDF staging and TTS routing | P1 | Cover critical store decision logic | planned | pending | coding-agent | Core store behavior has deterministic test coverage | P1-QA-001 |
| P1-QA-003 | Component tests for telemetry UI | P1 | Cover settings metrics panel and HUD toggles | planned | pending | coding-agent | Telemetry UI state changes are tested | P1-QA-001 |
| P1-QA-004 | Adapter contract tests | P1 | Shared test suite for each model adapter | planned | pending | coding-agent | Browser/Piper/Kokoro adapters satisfy common contract | P1-QA-001 |
| P1-QA-005 | CI quality gate pipeline | P1 | Enforce type-check/build/test in CI | planned | pending | coding-agent | CI blocks regressions for core checks | P1-QA-001 |
| P1-QA-006 | Hot-path logging static guard | P1 | Prevent reintroduction of noisy hot-loop logs | planned | pending | coding-agent | Guard fails if prohibited console usage is added | P0-RDR-007 |
| P2-UX-001 | Reduced-motion + low-power mode auto-detection | P2 | Accessibility and perf-friendly visual mode | planned | pending | coding-agent | Motion/effects respect device and user preferences | P0-RDR-009 |
| P2-UX-002 | Keyboard + ARIA audit pass | P2 | Improve accessibility semantics and navigation | planned | pending | coding-agent | Critical controls are fully keyboard and SR compatible | None |
| P2-UX-003 | Voice preview caching | P2 | Cache short sample previews for faster comparison | planned | pending | coding-agent | Preview switching feels immediate after first generation | P0-MDL-003 |
| P2-UX-004 | Document prefetch around reading position | P2 | Smart preload of near-future pages/content | planned | pending | coding-agent | Next/previous navigation latency decreases measurably | P0-RDR-003 |
| P2-UX-005 | In-app benchmark replay | P2 | Replay representative workloads for perf comparisons | planned | pending | coding-agent | Dev can replay standardized benchmark scenarios | P0-PFV-001 |
| P2-UX-006 | Optional visual regression snapshots | P2 | Snapshot key UI states for theme/layout regression checks | planned | pending | coding-agent | Snapshot suite catches major UI regressions | P1-QA-001 |

## Lower-Priority But High-Value Improvements
The following are explicitly lower priority than core P0 work, but still recommended:
- Reduced-motion and low-power rendering mode (`P2-UX-001`).
- In-app benchmark replay tooling (`P2-UX-005`).
- Voice preview caching (`P2-UX-003`).
- Near-position document prefetch (`P2-UX-004`).
- Keyboard navigation + ARIA hardening (`P2-UX-002`).
- Error taxonomy normalization (`P1-ARC-004`).
- Import cancellation/resume (`P1-LIB-002`).
- Optional visual regression snapshots (`P2-UX-006`).

## Required Per-Feature Verification (Charm Crush)
After each feature slice, the implementing agent must stop and provide:
1. Feature summary (what changed).
2. Browser test setup (`npm run preview`, URL open step).
3. Step-by-step browser checks for that specific feature.
4. Expected results and failure indicators.
5. Direct question to user: how they want to test this slice.

The next backlog item must not start until user feedback is received or user explicitly waives testing.

## Execution Order
### Phase 1: Foundation + Documentation bootstrap
- `DOC-001` through `DOC-005`
- `P0-PFV-001`
- `P0-RDR-007`

Done definition:
- Backlog and docs are in place.
- Logging policy and telemetry schema are established.
- Verification-first browser testing protocol is explicitly documented and enforced.

### Phase 2: Reader performance core
- `P0-RDR-001` through `P0-RDR-010`
- `P0-PFV-002`

Done definition:
- First-page latency improves and rendering is scheduler-driven.
- Baseline perf metrics are captured and comparable.

### Phase 3: Performance visualization UX
- `P0-PFV-003` through `P0-PFV-006`

Done definition:
- Settings panel and optional HUD expose actionable runtime metrics.

### Phase 4: Model system modernization
- `P0-MDL-001` through `P0-MDL-010`

Done definition:
- Model routing is deterministic, adapters are pluggable, fallback is explicit.

### Phase 5: Reliability + quality + polish
- `P1-ARC-*`, `P1-LIB-*`, `P1-QA-*`, `P2-UX-*`

Done definition:
- Reliability risks are reduced, tests are meaningful, and UX/accessibility improvements are landed.

## Commit Message Format
- `feat(backlog:<ID>): <short description>`
- `fix(backlog:<ID>): <short description>`
- `chore(backlog:<ID>): <short description>`
- `docs(backlog:<ID>): <short description>`

Examples:
- `feat(backlog:P0-RDR-001): stage pdf loading for faster first paint`
- `fix(backlog:P0-MDL-005): route speak through selected model descriptor`
- `docs(backlog:DOC-002): rewrite readme with modernization status`
