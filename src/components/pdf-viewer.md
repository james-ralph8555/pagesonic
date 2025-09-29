# PDF Viewer Tab — Technical Documentation

This document describes the implementation of the PDF Viewer tab, colocated with the relevant components for easy discovery during development.

## Components

- `PDFViewer.tsx`
  - Purpose: Top-level viewer UI (file open, navigation, zoom, keyboard shortcuts) and layout.
  - Key handlers:
    - `handleFileSelect(event)`: Loads a local `.pdf` via the store (`loadPDF(file)`).
    - `handlePrevPage()` / `handleNextPage()`: Updates `currentPage` via the store.
    - `handleZoomIn()` / `handleZoomOut()` / `handleFitPage()`: Updates `scale` via the store.
    - `handleKeydown(e)`: ArrowLeft/ArrowRight for navigation; `+`/`=` and `-`/`_` for zoom; `0` for reset; `F` toggles Fit-to-width (unmodified only; Ctrl/Cmd+F is respected for browser find).
  - Rendering: Shows metadata when available; renders the current page using `<PDFPage pageNumber={state.currentPage} scale={state.scale} />`.

- `PDFPage.tsx`
  - Props:
    - `pageNumber: number` — 1-based page index to render.
    - `scale: number` — Page scale (driven by `PDFViewer` zoom + fit-width).
    - `isVisible?: boolean` — Defaults to `true`; used for conditional rendering/virtualization.
  - Behavior:
    - On mount and whenever `pageNumber`, `scale`, or `isVisible` change, fetches the specified page via `getCurrentPage(pageNumber)` and renders it to a `<canvas>` using a viewport derived from `scale`.
    - Renders a selectable text layer over the canvas using `TextLayerBuilder` from `pdfjs-dist/web/pdf_viewer`.
    - Ensures the text layer aligns pixel-perfect with the canvas by setting the CSS variable `--total-scale-factor` to the current page `scale` on the PDF.js-generated `.textLayer` element and by reusing the exact same `viewport` used for the canvas.
    - Cancels any in-flight `renderTask` and text-layer task before starting a new render to avoid race conditions and artifacts.
    - Clears the canvas prior to each render.
  - Notes:
    - WebGL is disabled by default in the render context. Consider enabling if performance profiling warrants it.
    - The overlay container (`.pdf-text-layer`) is not manually sized; PDF.js sets dimensions via `setLayerDimensions` and the CSS variable.

## Text Layer Alignment and Zoom Integration

PDF.js computes positions for the selectable text using CSS calculations that depend on a CSS variable named `--total-scale-factor`. If that variable is missing or out of sync with the canvas scale, the text selection boxes will not align with the drawn glyphs.

Key points of our integration:

1) Shared viewport
   - The same `viewport` (created from `page.getViewport({ scale: props.scale })`) is used for both the canvas render and the text layer render.

2) Scaling via CSS variable
   - We set `--total-scale-factor` on the `.textLayer` element produced by PDF.js, using the page’s live `scale` value from props:

     ```ts
     const { TextLayerBuilder } = await import('pdfjs-dist/web/pdf_viewer')
     textLayerBuilder = new TextLayerBuilder({
       pdfPage: page,
       onAppend: (div: HTMLDivElement) => {
         // Keep text div positions in sync with canvas zoom
         div.style.setProperty('--total-scale-factor', String(props.scale))
         container.appendChild(div)
       }
     })
     await textLayerBuilder.render({ viewport })
     ```

3) CSS defaults
   - `src/index.css` defines a safe default: `.textLayer { --total-scale-factor: 1; }` so that calc() expressions remain valid even before the JS runs.
   - The overlay container `.pdf-text-layer` is absolutely positioned over the canvas, but we do not impose explicit pixel `width/height` on it. This avoids double-scaling and keeps the text layer geometry under PDF.js control.

4) Fit Width and manual zoom
   - `PDFViewer.tsx` computes `scale` per page. In fit-width mode it derives an absolute scale from the available container width; otherwise it multiplies by the user zoom value.
   - Because `props.scale` is passed to `PDFPage`, both the canvas and text layer get the same `viewport` and `--total-scale-factor`, staying aligned at all zoom levels and window sizes.

Common pitfalls avoided:
- Not setting `--total-scale-factor`: leads to text drifting from the canvas image.
- Using a different viewport for text vs canvas: causes offsets or incorrect scaling.
- Forcing text-layer container dimensions: may introduce double-scaling and misalignment.

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
4. The text layer is rendered with the same `viewport` and receives `--total-scale-factor` equal to the page `scale`.
5. On navigation/zoom, Solid signals trigger `<PDFPage>` to cancel any in-flight render and repaint; the text layer is rebuilt with the updated scale.

## Worker Configuration

- `public/pdf.worker.min.js` (and unminified `pdf.worker.js`) must exist.
- The store sets `pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'` before loading a document.
- Minimal `.textLayer` styles are included in `src/index.css` to enable alignment and selection.

## Keyboard Shortcuts

- ArrowLeft / ArrowRight — Previous / Next page
- `+` or `=` — Zoom in
- `-` or `_` — Zoom out
- `0` — Fit page (scale 1.0)
- `F` — Toggle Fit to width (no modifiers; Ctrl/Cmd+F remains browser Find)

## Manual Test Checklist

- Load a PDF and verify metadata appears when available.
- Use Next/Previous and Arrow keys; the canvas should update each time.
- Zoom in/out and Fit; the canvas and text selections remain perfectly aligned.
- Buttons disable at first/last page; scale clamps within bounds.
- Load another PDF; state resets to page 1 and metadata updates.

## Troubleshooting Text Layer Alignment

- Text selection boxes don’t align with rendered text:
  - Verify `--total-scale-factor` is being set on the `.textLayer` element (inspect in devtools).
  - Ensure the same `viewport` instance is passed to both the canvas render and `TextLayerBuilder.render`.
  - Remove manual sizing on the overlay container; let PDF.js manage dimensions.


## Troubleshooting

- Worker 404: Ensure `/public/pdf.worker.min.js` exists and path matches the store’s `workerSrc`.
- Navigation not re-rendering: Ensure this branch’s `PDFPage` reads `pageNumber`/`scale` inside `createEffect` and calls `getCurrentPage(pageNumber)`.
- Performance: Only the current page is rendered (no continuous scroll). Consider continuous mode with virtualization if needed.

## Extensibility

- Add continuous scroll and a thumbnail strip.
- Add TOC sidebar, in-page link handling, selections, and annotations.
- Optional: migrate to PDFSlick for a richer reactive wrapper atop PDF.js.
