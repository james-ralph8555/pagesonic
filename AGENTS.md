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

### Environment Assumptions

The following services are always assumed to be running:
- Dev server: `http://localhost:3001`
- Chrome DevTools Protocol: `http://localhost:9223`

**Never start these services.** They are managed externally.

### Available MCP Tools

All tools are prefixed with `mcp_chrome-devtools_`:

- Navigation: `navigate_page`, `new_page`, `close_page`, `list_pages`, `select_page`, `wait_for`
- Input: `click`, `fill`, `fill_form`, `hover`, `press_key`, `drag`, `handle_dialog`, `upload_file`
- Debugging: `take_screenshot`, `take_snapshot`, `evaluate_script`, `list_console_messages`
- Performance: `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`
- Network: `list_network_requests`, `get_network_request`

### Browser Verification with MCP

After completing code changes and CLI validation, automatically run browser verification:

1. Navigate to the relevant route: `mcp_chrome-devtools_navigate_page` to `http://localhost:3001`
2. Interact with the feature using `mcp_chrome-devtools_click`, `mcp_chrome-devtools_fill`, etc.
3. Capture state with `mcp_chrome-devtools_take_screenshot` and `mcp_chrome-devtools_take_snapshot`
4. Check for errors with `mcp_chrome-devtools_list_console_messages`
5. Report results to user with:
   - Test steps performed
   - Screenshots/snapshots captured
   - Any console errors or unexpected behavior
   - Request manual user validation

### Test PDF Fixtures

Pre-built test PDFs are available for automated browser verification without file picker interaction:

| URL Parameter | Pages | Use Case |
|---------------|-------|----------|
| `?test-pdf=short` | 3 | Quick smoke tests |
| `?test-pdf=medium` | 15 | Moderate content scenarios |
| `?test-pdf=long` | 50 | Performance/stress testing |

**Usage:**
```
mcp_chrome-devtools_navigate_page to http://localhost:3001/?test-pdf=short
```

The PDF will auto-load on mount. Check console for `[PDF] First page ready in X ms · N pages total` to confirm.

**Regenerating test PDFs:**
```bash
npx ts-node scripts/generate-test-pdfs.ts
```

## Console Logging System

The project uses a context-aware Logger (`src/utils/logger.ts`) to prevent console flooding on large documents. By default, only the `general` context is enabled. Other contexts (`pdf`, `tts`, `audio`, `opfs`, etc.) are suppressed unless explicitly enabled.

### Available Contexts

- `general` - Always enabled by default
- `pdf` - PDF loading, page rendering, IntersectionObserver events
- `tts` - Text-to-speech synthesis, chunk processing
- `audio` - Audio playback, queue management
- `opfs` - Origin Private File System operations
- `leader-election` - Tab leadership coordination
- `broadcast-channel` - Cross-tab communication
- `library-store` - Document library state

### Enabling Debug Logs via MCP

Use `evaluate_script` to toggle logging contexts:

```javascript
// Enable PDF debug logs
() => {
  window.__logger.setContextsEnabled(['pdf'], true);
  return window.__logger.getEnabledContexts();
}

// Enable multiple contexts
() => {
  window.__logger.setContextsEnabled(['pdf', 'tts', 'audio'], true);
  return window.__logger.getEnabledContexts();
}

// Disable a context
() => {
  window.__logger.setContextsEnabled(['pdf'], false);
  return window.__logger.getEnabledContexts();
}
```

### When to Enable Contexts

- Enable `pdf` when debugging page loading, rendering order, or scroll issues
- Enable `tts` when debugging speech synthesis or chunk queue problems
- Enable `audio` when debugging playback issues
- Always disable verbose contexts after debugging to keep console readable

## Charm Crush Testing Protocol
Use this message structure after each feature implementation:
1. `What changed`: one paragraph summary.
2. `Automated MCP Verification`:
   - Use MCP tools to navigate, interact, and verify the feature works
   - Check console messages for errors
   - Report findings to user before manual testing
3. `How to test in browser`:
   - navigate to `http://localhost:3001`,
   - perform 3-8 feature-specific steps,
   - compare to expected results.
4. `Ask the user`: "How would you like to test this slice in your browser? If you want, use the checklist above."
5. `Stop`: wait for user feedback before moving to the next backlog ID.
