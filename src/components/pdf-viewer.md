# PDF Viewer Tab — Technical Documentation

This document describes the implementation of the PDF Viewer tab, colocated with the relevant components for easy discovery during development.

## Components

- `PDFViewer.tsx`
  - Purpose: Top-level viewer UI (file open, navigation, zoom, keyboard shortcuts) and layout.
  - Key handlers:
    - `handleFileSelect(event)`: Loads a local `.pdf` via the store (`loadPDF(file)`).
    - `handlePrevPage()` / `handleNextPage()`: Updates `currentPage` via the store.
    - `handleZoomIn()` / `handleZoomOut()` / `handleFitPage()`: Updates `scale` via the store.
    - `handleKeydown(e)`: ArrowLeft/ArrowRight for navigation; `+`/`=` and `-`/`_` for zoom; `0` for fit.
  - Rendering: Shows metadata when available; renders the current page using `<PDFPage pageNumber={state.currentPage} scale={state.scale} />`.

- `PDFPage.tsx`
  - Props:
    - `pageNumber: number` — 1-based page index to render.
    - `scale: number` — Page scale (clamped in the store to `[0.1, 3.0]`).
    - `isVisible?: boolean` — Defaults to `true`; used for conditional rendering/virtualization.
  - Behavior:
    - On mount and whenever `pageNumber`, `scale`, or `isVisible` change, fetches the specified page via `getCurrentPage(pageNumber)` and renders it to a `<canvas>` using a viewport derived from `scale`.
    - Cancels any in-flight `renderTask` before starting a new render to avoid race conditions and artifacts.
    - Clears the canvas prior to each render.
  - Notes:
    - WebGL is disabled by default in the render context. Consider enabling if performance profiling warrants it.

## Store (`src/stores/pdf.ts`)

- Reactive state (`state: Accessor<PDFState>`):
  - `document: PDFDocument | null` — Extracted metadata.
  - `pages: PDFPage[]` — Precomputed page geometry + text (scale 1.0 reference).
  - `currentPage: number` — 1-based; clamped within `[1, pages.length]`.
  - `scale: number` — Clamped within `[0.1, 3.0]`.
  - `isLoading: boolean`, `error: string | null`.
  - `pdfDoc: any` — PDF.js document instance.

- Public API:
  - `async loadPDF(file: File): Promise<void>` — Loads document, extracts metadata, precomputes page geometry, and caches text (`getTextContent()`). Sets worker: `pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'`.
  - `async getCurrentPage(pageNumber?: number): Promise<any | null>` — Returns a PDF.js page. Defaults to `state().currentPage` if not provided.
  - `async extractTextFromPage(pageNumber: number): Promise<string>` — Returns joined `item.str` text for a page.
  - `getAllExtractedText(): string` — Concatenates cached page text.
  - `setCurrentPage(page: number): void` — Clamps to valid bounds.
  - `setScale(scale: number): void` — Clamps to valid bounds.

## Rendering Pipeline

1. User selects a file → `loadPDF(file)` reads ArrayBuffer and initializes `pdfDoc` via `pdfjs.getDocument({ data })`.
2. For each page: the store captures geometry at scale 1.0 and caches text for Reader Mode.
3. `<PDFPage>` requests `getCurrentPage(pageNumber)` and renders to canvas with `page.getViewport({ scale })`.
4. On navigation/zoom, Solid signals trigger `<PDFPage>` to cancel any in-flight render and repaint.

## Worker Configuration

- `public/pdf.worker.min.js` (and unminified `pdf.worker.js`) must exist.
- The store sets `pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'` before loading a document.

## Keyboard Shortcuts

- ArrowLeft / ArrowRight — Previous / Next page
- `+` or `=` — Zoom in
- `-` or `_` — Zoom out
- `0` — Fit page (scale 1.0)

## Manual Test Checklist

- Load a PDF and verify metadata appears when available.
- Use Next/Previous and Arrow keys; the canvas should update each time.
- Zoom in/out and Fit; the canvas should resize sharply.
- Buttons disable at first/last page; scale clamps within bounds.
- Load another PDF; state resets to page 1 and metadata updates.

## Troubleshooting

- Worker 404: Ensure `/public/pdf.worker.min.js` exists and path matches the store’s `workerSrc`.
- Navigation not re-rendering: Ensure this branch’s `PDFPage` reads `pageNumber`/`scale` inside `createEffect` and calls `getCurrentPage(pageNumber)`.
- Performance: Only the current page is rendered (no continuous scroll). Consider continuous mode with virtualization if needed.

## Extensibility

- Add continuous scroll and a thumbnail strip.
- Add TOC sidebar, in-page link handling, selections, and annotations.
- Optional: migrate to PDFSlick for a richer reactive wrapper atop PDF.js.
