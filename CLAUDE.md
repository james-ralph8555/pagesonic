# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PageSonic is a PDF reader with text-to-speech capabilities built with SolidJS and TypeScript. It supports offline TTS using ONNX models and browser-based PDF viewing.

## Development Commands

- `npm run dev` - Start development server on port 3000
- **DO NOT RUN DEVELOPMENT SERVER**
- `npm run build` - Build for production
- `npm run type-check` - Run TypeScript type checking
- `npm run preview` - Preview production build

## Architecture

### Core Technologies
- **SolidJS** - Reactive UI framework with signals for state management
- **PDF.js** - PDF rendering and text extraction
- **ONNX Runtime Web** - Local TTS model inference
- **IndexedDB** - Offline storage via `idb` library

### Application Structure
- **App Modes**: Two main views - 'pdf' (document viewer) and 'settings'
- **State Management**: Custom store pattern using SolidJS signals
  - `src/stores/pdf.ts` - PDF document state, loading, and navigation
  - `src/stores/tts.ts` - TTS model loading, playback controls, and voice settings

### Key Components
- `PDFViewer` - Main PDF viewing interface with page navigation
- `PDFPage` - Individual page rendering component
- `SelectionToolbar` - Text selection and TTS controls
- `SettingsView` - TTS model selection and voice configuration

### TTS System
- **Models**: Supports Kokoro (82MB, requires WebGPU) and Kitten (15MB, CPU/WebGPU)
- **Model Files**: Located in `public/models/` (see `public/models/README.txt`)
- **Fallback**: Browser SpeechSynthesis when local models unavailable
- **Runtime Configuration**: WASM for CPU, WebGPU for accelerated inference

### PDF Processing
- Text extraction performed during document load
- Page-by-page rendering with configurable scale
- Metadata extraction (title, author, creation date, etc.)

### Build Configuration
- Vite with SolidJS plugin
- Manual chunks for vendor libraries (SolidJS, PDF.js, ONNX Runtime)
- Cross-origin headers for WebGPU compatibility
- Path alias: `@/` maps to `src/`

## Development Notes

### WebGPU Requirements
- Kokoro model requires WebGPU support
- Server headers configured for cross-origin isolation
- Check `state().isWebGPUSupported` before loading WebGPU models

### Model Assets
- TTS models must be placed in `public/models/`
- Expected filenames: `kokoro-82m.onnx`, `kitten-15m.onnx`
- Models are large; consider HTTP range requests for deployment

### Type Safety
- Strict TypeScript configuration
- Interfaces defined in `src/types/index.ts`
- PDF.js instances typed as `any` due to library limitations