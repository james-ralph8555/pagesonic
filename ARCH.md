Architecture Report: Local PDF Viewer + Reader
with SolidJS & Web‑based TTS
1. Introduction
This blueprint describes how to build a local, privacy‑preserving PDF viewer and reader with an optional
real‑time audiobook mode using SolidJS and TypeScript. The goal is to run everything client‑side in the
browser without back‑end services so users can view PDFs, extract text, and hear audio narration even
when offline. The report draws on up‑to‑date documentation and research (as of 2025) to validate feasibility
and identify limitations.
2. Technical stack and overall architecture
2.1 Core framework
SolidJS + TypeScript – chosen for its fine‑grained reactivity and superior performance compared to
React. SolidJS updates only the parts of the DOM that change, reducing memory usage and render
overhead . This efficiency is important when rendering heavy PDF pages and running a TTS
model concurrently. A fallback plan uses React + Next.js if no stable SolidJS solution exists.
Build tooling – recommended to use Vite for fast development builds with SolidJS; it supports ES
modules, lazy loading and code‑splitting. Use vite-plugin-solid to compile SolidJS components
into efficient code.
Packaging – compile the site into static assets (HTML, JS, CSS) and store them in an S3 bucket
behind an AWS CloudFront distribution. The AWS CDK code for such a deployment sets up an S3
bucket with CloudFront as the origin, redirects HTTP to HTTPS, enables compression, and defines
index.html as the root document . A BucketDeployment pushes the compiled site to S3
. CloudFront caching is controlled via cache invalidations when new builds are deployed .
2.2 Use of off‑the‑shelf libraries
PDF viewing – integrate PDF.js via the PDFSlick wrapper for SolidJS. PDFSlick exposes a
usePDFSlick hook that loads a PDF and returns a reactive store with properties like
pageNumber , scale and numPages . The <PDFSlickViewer> component renders pages with
minimal UI; developers can build custom controls by reading the store . PDFSlick wraps PDF.js so
that reactive frameworks like SolidJS can subscribe to state changes, addressing integration
difficulties of vanilla PDF.js .

Implementation note (current code): The initial implementation uses plain PDF.js with SolidJS
signals (see src/stores/pdf.ts and src/components/PDFPage.tsx) rather than PDFSlick. This keeps
the dependency surface small and performs well, but we can swap to PDFSlick later if we want its
built-in store and utilities.
Text extraction – PDF.js exposes getTextContent() for each page. A typical extraction function
loops through all pages and concatenates item.str from text.items[] to build the page text
•
1
•
•
2
3 4
•
5
6
•
1
. This asynchronous process must be memoised to avoid repeated parsing when the user seeks
within audio.
Table of contents (TOC) – pdf.getOutline() returns the document outline; each item’s
destination can be resolved to a page index via getDestination() and getPageIndex() .
Because PDF.js uses zero‑based indices, add 1 to convert to human page numbers . This TOC
should feed the chapter structure for the reader and audiobook mode.
TTS models – the system will use small, open TTS models that run on WebGPU. Research
summarised by the tts‑studio comparison shows:
Kitten TTS – ~15 M parameters, ~24 MB model, 8 expressive voices, WebGPU‑accelerated, runs 2‑3×
real time on mobile . Audio quality is decent but may sound robotic.
Kokoro TTS – 82 M parameters (~82 MB on‑disk), 21 expressive voices, WebGPU support, 1–2× real
time . Sounds natural and is better for audiobook quality.
Piper TTS – 75 MB model, ~904 voices but not WebGPU accelerated (runs on WASM only) .
Because the requirement is <100 M parameters with real‑time performance on iPhone Safari, Kokoro TTS
is a strong candidate. It supports WebGPU and can achieve near real‑time on devices with iOS 26 (first Safari
version with WebGPU) . For older devices or when GPU is unavailable, Kitten TTS can serve as a fallback
due to its small size and CPU feasibility .
ONNX Runtime Web – used to run the TTS models. To enable WebGPU, import the WebGPU build
( onnxruntime-web/webgpu ) and specify executionProviders: ['webgpu'] when creating
the session . WebGPU support in ONNX Runtime reduces latency by executing model kernels on
the GPU. The library also allows IO binding to keep tensors on GPU memory to avoid copying
overhead .
2.3 Caching & offline operation
Service worker – implement a service worker that caches static assets, PDF documents, WASM
bundles and ONNX models using the Cache API. The MDN PWA tutorial explains how service
workers can intercept network requests, serve cached responses and prefetch resources for offline
use . Pre‑cache the PDF viewer UI and TTS models during the install event and update
caches during activate .
IndexedDB – large assets (e.g., ONNX models or PDF files) can be stored in IndexedDB. This avoids
repeated downloads and makes offline operation smoother. Use streaming downloads with progress
bars to inform the user.
Cache versioning – version your cache names (e.g., pdfviewer-v1 ) so that old caches can be
cleared during service worker activate events . For models, embed a version number in the
file name and update only when necessary.
7
•
8
•
•
9
•
10
• 11
12
13
•
14
15
•
16
•
•
17
2
2.4 Hardware acceleration and fallback
WebGPU is still an emerging standard. Chrome and Edge have had WebGPU since 2023; Firefox shipped
support in 2025; Safari 26 (iOS 26) brings the first official WebGPU support on iPhones . However, a
Medium analysis notes that WebGPU still suffers from memory limits (~256 MB on some iPhones) and
device crashes, and that only about 65 % of browsers support it . This influences our plan:
Primary mode: Use WebGPU‑accelerated ONNX models when the browser supports it. Query
navigator.gpu to detect support.
Fallback: If WebGPU is unavailable or memory limits cause failure, switch to the WASM backend of
ONNX Runtime or a smaller model (Kitten TTS). The audio quality may degrade and CPU usage
increases.
CPU fallback: As a last resort, use the browser’s built‑in SpeechSynthesis API for basic
text‑to‑speech, though quality and language support may be limited.
3. Views and UI design
3.1 PDF view (basic mode)
Minimal UI – present PDF pages using <PDFSlickViewer> with only essential controls: zoom,
page navigation and file open. Avoid heavy toolbars to keep the interface clean. Use SolidJS signals
to handle scale and pageNumber from the PDFSlick store, enabling custom navigation elements
.
Performance considerations – PDF pages are canvas elements; avoid rendering all pages at once.
Use virtualization or lazy loading so only visible pages render. Provide skeleton loading spinners
during page rendering.
Accessibility – ensure buttons have appropriate aria-labels and can be operated via keyboard.
Provide high‑contrast mode and variable text size.

See `src/components/pdf-viewer.md` for detailed implementation notes, usage, shortcuts, testing, and troubleshooting for the PDF Viewer tab.
3.2 Reader view
Text extraction – when the user switches to reader mode, asynchronously extract text and MathML
from each page via pdf.getPage().getTextContent() ; parse out item.str values and build
paragraphs . Cache these results to avoid recomputation. For equations, rely on PDF.js’s built‑in
rendering or convert LaTeX into MathML using libraries such as mathjax . Present the extracted
text in a scrollable container with consistent font sizes. Provide search functionality and highlight
search results.
TOC navigation – build the table of contents using pdf.getOutline() and map entries to page
numbers via getDestination() and getPageIndex() . Because indices are zero‑based,
increment them by one . Display the TOC as a collapsible sidebar; clicking a chapter scrolls to that
page or text location.
18
19 20
1.
2.
3.
•
5
•
•
•
7
•
8
3
Theming – start with a basic default theme (light background with dark text). Expose CSS variables
for colours, fonts and margins so future theming can easily be added. Provide settings for line
spacing and typeface.
3.3 Audiobook mode (within reader view)
Real‑time TTS – when audiobook mode is activated, feed the extracted text to the TTS model
incrementally. Use a queue: while audio is being generated for current sentences, prefetch and start
generating the next segment. Ensure the model runs in streaming or chunked mode to avoid large
memory footprints. Use WebAudio API to play audio; implement controls (play/pause, seek, speed,
voice selection).
Battery warning – generating audio on‑device is compute‑intensive; display a warning (only once
per session) advising users to plug in or disable low‑power mode. Provide a “Don’t show again”
option to store in local storage. For accessibility, the warning should be spoken via screen reader.
Model selection – default to Kokoro TTS (82 M) for high quality. When memory is limited or
WebGPU fails, fall back to Kitten TTS (15 M). Optionally allow users to choose. Document the model
sizes and expected performance: Kokoro runs near real time on iOS 26 Safari with WebGPU support
; Kitten is smaller and runs on CPU with 2–3× real‑time speed .
Loading and caching models – models are loaded over the network and cached locally. Use a
streaming download with progress feedback. If the model is already cached in IndexedDB, skip the
download. Service worker caches the .onnx file in case of offline use.
Fine‑grained control – provide slider controls for speech rate and pitch. When the user navigates
the text, compute the approximate position in the audio and seek accordingly by restarting TTS
generation at that sentence.
Accessibility & theming – audio controls should be reachable by keyboard and screen readers.
Provide transcript text synchronised with audio (karaoke‑style highlighting) for the hearing‑impaired.
3.4 Conversions (planned feature)
Format compatibility – initially support PDF input only. Future work may add importers for ePub,
Docx or Markdown. Each converter would run client‑side using WebAssembly modules (e.g.,
pandoc compiled to WebAssembly) and convert to the internal reader format.
Placement – conversions could be part of the same interface (e.g., “Import” button) but are outside
the scope of the initial release. Plan to modularise conversion logic so that adding support for new
formats doesn’t affect the core PDF pipeline.
•
•
•
•
10 12 9
•
•
•
•
•
4
4. TTS integration details
4.1 Loading ONNX models in the browser
Import ONNX runtime – import the WebGPU build: import * as ort from 'onnxruntime-
web/webgpu' . For WebGPU fallback, import the default onnxruntime-web build.
Create session with WebGPU – when creating the inference session, specify
executionProviders: ['webgpu'] to run kernels on the GPU . Optionally set
preferredOutputLocation: 'gpu-buffer' to keep tensors on the GPU and reduce CPU copies
.
Graph capture – enable graph capture if the model uses static shapes; this can improve
performance by executing multiple kernels at once .
IO binding – keep intermediate tensors on GPU memory to avoid copying back to CPU during
streaming. Use Tensor.fromGpuBuffer() for inputs and specify preferredOutputLocation
for outputs .
Stream inference – for long text, break input into sentences and run inference in sequence. Use
Web Audio API’s AudioBufferSourceNode to queue audio segments for playback.
4.2 API for audio generation
Kokoro JS wrapper – the kokoro-js library can load models from Hugging Face and generate
audio via KokoroTTS.from_pretrained() and generate() methods . However, this library
may require bundler configuration. If integration with SolidJS proves difficult, load the ONNX model
manually and implement the inference pipeline (phoneme conversion, mel-spectrogram generation,
vocoder) using ONNX Runtime.
Voice selection – Kokoro includes multiple voices; store voice embeddings and feed them into the
model’s condition vector. Present a dropdown for voice selection and remember the user’s choice.
Memory and compute – if the device cannot allocate the 82 MB model, detect GPUBuffer errors
and inform the user. Provide an option to fall back to a CPU backend or remote TTS (future feature)
at the cost of privacy.
5. Offline storage and caching strategy
Service worker – register at site load. Use install event to cache index.html , compiled JS
bundles, PDFSlick assets, CSS, icon fonts, and default ONNX models. Use fetch event to serve
cached resources when offline; if resource isn’t cached, fetch from network and add to cache for
future use . Delete old caches during activate .
IndexedDB – store large binary assets (PDF files the user opens and ONNX models) in IndexedDB via
idb library. When the user opens a PDF from local storage, save it to the database so offline
re‑opening is fast. Provide UI to clear the cache and show storage usage.
Chunked downloads – models may be large (15–80 MB). Use HTTP range requests or streaming
fetch to display progress and avoid blocking the UI. Save partially downloaded chunks in cache to
resume on reload.
1.
2.
14
21
3.
22
4.
23
5.
•
24
•
•
1.
16 17
2.
3.
5
Version management – include a manifest JSON with model names and hashes. When the manifest
version changes, the service worker downloads new models and deletes old ones.
6. Deployment details
Build pipeline – configure Vite to output hashed filenames in dist/ . Use vite-plugin-svelte-
inspector for debugging if necessary. Generate Service Worker using vite-plugin-pwa or
custom script.
AWS CDK infrastructure – create an S3 bucket with blocked public access. Deploy CloudFront
distribution with S3 origin. Configure default behaviour to allow GET, HEAD and OPTIONS, enable
compression and redirect HTTP to HTTPS . Set defaultRootObject to index.html and
configure error responses to fallback to index.html so that client‑side routing works .
Deployment – after building, copy dist/ to S3. CloudFront caches the files; create an invalidation
after each deploy to ensure new versions propagate . Automate with GitHub Actions or AWS
CodeBuild.
No backend required – the site is purely static. All inference occurs in the browser. Use the AWS
infrastructure only to serve static assets. For optional telemetry (e.g., error reporting), send
anonymised logs to an external endpoint but ensure user consent.
7. Validation and testing plan
Compatibility testing – test on Chrome, Edge, Firefox (with and without WebGPU flags) and iOS 26
Safari. Validate that WebGPU detection falls back gracefully to CPU. Ensure the TTS pipeline runs
within a memory budget (<256 MB) on iPhone Safari .
Performance metrics – measure page render times, memory usage and audio generation latency.
Compare SolidJS performance to a prototype implemented in React; if SolidJS fails to meet
expectations or lacks stable libraries, revert to React + Next.js (as allowed by requirements) while
preserving the same architecture.
Accessibility testing – use screen readers (VoiceOver, NVDA) to ensure controls are navigable.
Validate high‑contrast mode and caption synchronisation. Provide user preferences (font size,
theme) with persistence.
Offline behaviour – test offline by disabling the network. Ensure previously viewed PDFs and
models still open, and audiobook mode works with cached models. Validate that service worker
updates occur when connecting online.
Battery consumption – measure battery usage on iPhone during audiobook generation. Provide
warnings when consumption is high. Consider implementing a low‑power mode that slows down
TTS or reduces sampling rate when the battery is below a threshold.
8. Future enhancements
OCR integration – for scanned PDFs without embedded text, integrate an on‑device OCR model
such as dots‑ocr compiled to WASM. This can extract text and equations before feeding to reader/
4.
•
•
2
25
•
4
•
1.
19
2.
3.
4.
5.
•
6
TTS modes. Ensure OCR runs on WebAssembly threads with fallback to CPU. This is marked as a
future release.
Advanced theming – support dark mode, sepia, and user‑defined colour schemes. Expose CSS
variables and allow saving preferences to local storage.
Note‑taking and annotations – allow users to highlight text, add notes and export them. Use PDF.js
annotation API and store notes in IndexedDB.
Multi‑language support – integrate language detection and translation. Use the browser’s
translation API or small translation models; feed the result to TTS for cross‑language reading.
Remote TTS or streaming – for users who prefer not to download large models, allow streaming
audio generation from a server. This introduces privacy considerations and should be optional with
user consent.
CI/CD pipeline – automate deployments with GitHub Actions, including building, testing, caching
invalidation and CDK deployment.
9. Conclusion
This architecture demonstrates that a privacy‑preserving, offline‑capable PDF reader with audiobook
functionality is feasible using SolidJS and modern web technologies. PDF rendering and text extraction
leverage proven libraries like PDF.js via PDFSlick , while TTS models such as Kokoro TTS or Kitten TTS
can run in the browser using ONNX Runtime Web with WebGPU . However, developers should expect
WebGPU limitations, particularly on mobile devices , and must provide robust fallbacks and caching
strategies. With careful asset management and service‑worker caching, the application can run entirely
client‑side and be deployed as a static site on AWS S3 and CloudFront . The blueprint anticipates future
enhancements such as OCR, advanced theming, and remote services while maintaining a forward‑looking
view on the evolving web‑AI landscape.
•
•
•
•
•
5
14
19
2
7
Solidjs vs. React 2025 Comparison, Performance & Features : Aalpha
https://www.aalpha.net/blog/solidjs-vs-react-comparison/
Deploy a Static Website on AWS S3 and CloudFront with AWS CDK
https://blog.tericcabrel.com/static-website-aws-s3-cloudfront-cdk/
GitHub - pdfslick/pdfslick: View and Interact with PDFs in React, SolidJS, Svelte and JavaScript apps
https://github.com/pdfslick/pdfslick
Extract text from PDF files using PDF.js and JavaScript | Nutrient
https://www.nutrient.io/blog/how-to-extract-text-from-a-pdf-using-javascript/
Creating a Table-of-Contents with PDF.js | by Sofia Sousa | Medium
https://medium.com/@csofiamsousa/creating-a-table-of-contents-with-pdf-js-4a4316472fff
GitHub - clowerweb/tts-studio: Test and compare browser-based TTS models!
https://github.com/clowerweb/tts-studio
The Untold Revolution in iOS 26: WebGPU Is Coming
https://brandlens.io/blog/the-untold-revolution-beneath-ios-26-webgpu-is-coming-everywhere-and-it-changes-everything/
Kitten-TTS : Smallest TTS for CPU | by Mehul Gupta | Data Science in Your Pocket | Aug, 2025 | Medium
https://medium.com/data-science-in-your-pocket/kitten-tts-smallest-tts-for-cpu-24f97186ec6d
Using WebGPU | onnxruntime
https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
js13kGames: Making the PWA work offline with service workers - Progressive web apps | MDN
https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/js13kGames/Offline_Service_workers
AI In Browser With WebGPU: 2025 Developer Guide
https://aicompetence.org/ai-in-browser-with-webgpu/
WebGPU bugs are holding back the browser AI revolution | by Marcelo Emmerich | Medium
https://medium.com/@marcelo.emmerich/webgpu-bugs-are-holding-back-the-browser-ai-revolution-27d5f8c1dfca
onnx-community/Kokoro-82M-v1.0-ONNX · Hugging Face
https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
1
2 3 4 25
5 6
7
8
9 10 11
12
13
14 15 21 22 23
16 17
18
19 20
24
8
