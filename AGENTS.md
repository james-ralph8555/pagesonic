# PageSonic Agent Guide

## Mission
Ship reliable, measurable improvements to PageSonic using the backlog in `docs/IMPLEMENTATION_BACKLOG.md`.

## Non-Negotiables
- Do not run `npm run dev` in this environment.
- Before merge, run:
1. `npm run type-check`
2. `npm run build`
- Keep changes scoped to the selected backlog item(s).
- Do not mark a feature `done` until browser test instructions are provided to the user and user feedback is captured.

## Architecture Boundaries
- `src/components/`: presentation/UI composition.
- `src/stores/`: state orchestration and app-domain flow.
- `src/tts/`: model runtime, worker, synthesis pipeline.
- `src/utils/`: side-effect helpers (audio, storage, browser integration).
- `src/types/`: shared contracts and domain interfaces.

## Backlog-Driven Workflow
1. Pick one `planned` backlog ID from `docs/IMPLEMENTATION_BACKLOG.md`.
2. Confirm dependencies are complete.
3. Implement exactly that scope.
4. Validate (`type-check`, `build`, tests if available).
5. Stop and start a verification handshake in Charm Crush:
- ask the user how they want to test this feature slice,
- provide explicit browser test steps for this slice,
- include expected results and failure signals.
6. Wait for user response before moving to the next backlog item unless the user explicitly waives manual testing.
7. Update the same backlog row:
- `Status` (`done` or `blocked`)
- `PR/Commit` (commit hash)
8. Commit with backlog ID in message.

## Commit Format
- `feat(backlog:<ID>): <short description>`
- `fix(backlog:<ID>): <short description>`
- `chore(backlog:<ID>): <short description>`
- `docs(backlog:<ID>): <short description>`

Examples:
- `feat(backlog:P0-RDR-001): stage pdf loading for faster first paint`
- `fix(backlog:P0-MDL-005): align speak routing with selected model`
- `docs(backlog:DOC-002): rewrite readme modernization status`

## Review Checklist
- Scope matches backlog item acceptance criteria.
- No unrelated refactors in same commit.
- Error handling is explicit and typed where possible.
- Hot-path logging is minimized.
- Docs/backlog row updated when behavior changes.
- User-facing browser test instructions are provided for the feature slice.
- User verification status is captured before marking `done`.

## Quality Gates
Minimum gates per feature slice:
1. `npm run type-check` passes.
2. `npm run build` passes.
3. Manual sanity path for changed surface is validated in browser.
4. In Charm Crush, present a browser test checklist and ask user how they want to test.
5. Do not begin next feature slice until user confirms test result or explicitly defers testing.

If a gate fails, do not mark backlog item `done`.

## Charm Crush Testing Protocol
Use this message structure after each feature implementation:
1. `What changed`: one paragraph summary.
2. `How to test in browser`:
- run `npm run preview`,
- open the preview URL,
- perform 3-8 feature-specific steps,
- compare to expected results.
3. `Ask the user`: "How would you like to test this slice in your browser? If you want, use the checklist above."
4. `Stop`: wait for user feedback before moving to the next backlog ID.
