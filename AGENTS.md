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

## Chrome DevTools MCP

This project is configured with Chrome DevTools MCP (`.crush.json`) for browser automation.

### Setup

Start Chromium with remote debugging before using browser tools:

```bash
chromium --remote-debugging-port=9223 --user-data-dir=/tmp/chrome-debug-profile
```

### Available MCP Tools

All tools are prefixed with `mcp_chrome-devtools_`:

- Navigation: `navigate_page`, `new_page`, `close_page`, `list_pages`, `select_page`, `wait_for`
- Input: `click`, `fill`, `fill_form`, `hover`, `press_key`, `drag`, `handle_dialog`, `upload_file`
- Debugging: `take_screenshot`, `take_snapshot`, `evaluate_script`, `list_console_messages`
- Performance: `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`
- Network: `list_network_requests`, `get_network_request`

### Browser Verification with MCP

When running browser verification:

1. `mcp_chrome-devtools_navigate_page` to load the target URL
2. `mcp_chrome-devtools_take_screenshot` to capture state
3. `mcp_chrome-devtools_click` / `mcp_chrome-devtools_fill` for interactions
4. `mcp_chrome-devtools_list_console_messages` to check for errors

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
