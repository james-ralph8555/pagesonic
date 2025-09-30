# PageSonic

A privacy-preserving PDF reader with text-to-speech capabilities that runs entirely in your browser. PageSonic processes documents locally without sending any data to external servers, ensuring your reading materials remain private.

## What PageSonic Does

PageSonic is a browser-based application that:
- Loads and displays PDF documents locally in the browser
- Extracts text from PDF pages for reading
- Provides text-to-speech functionality using either browser SpeechSynthesis or local ONNX models
- Works entirely offline with no external server communication
- Supports both CPU and WebGPU acceleration for TTS models

## Features

### PDF Viewing
- **Local PDF Processing**: Documents are processed entirely in your browser
- **Text Extraction**: Automatically extracts text from PDF pages for reading
- **Page Navigation**: Easy navigation through multi-page documents
- **Zoom Controls**: Zoom in/out and fit-to-width viewing options
- **Text Selection**: Select text for speaking, highlighting, or bookmarking

### Text-to-Speech
- **Dual TTS Engines**: 
  - Browser SpeechSynthesis (built-in system voices)
  - Local ONNX models (Kokoro 82MB, Kitten 15MB)
- **Voice Selection**: Choose from available voices based on loaded model
- **Speech Controls**: Play, pause, resume, and stop functionality
- **Chunking System**: Intelligent text chunking for optimal TTS performance
- **Customizable Settings**: Adjust rate, pitch, chunk size, and overlap

### Privacy & Security
- **100% Local Processing**: No data sent to external servers
- **Offline Capable**: Works without internet connection
- **No Tracking**: No analytics or usage data collection
- **Document Privacy**: Your PDFs never leave your browser

### Technical Features
- **WebGPU Acceleration**: Hardware-accelerated TTS when available
- **Cross-Origin Isolation**: Proper COOP/COEP headers for WebGPU compatibility
- **Progressive Web App**: Can be installed as a standalone application
- **Responsive Design**: Works on desktop and mobile devices

## Getting Started

### Prerequisites
- Modern web browser with JavaScript and WASM support
- For WebGPU TTS models: Browser with WebGPU support (Chrome/Edge 113+)

### Installation

#### Development
```bash
# Clone the repository
git clone https://github.com/james-ralph8555/pagesonic.git
cd pagesonic

# Install dependencies
npm install

# Start development server
npm run dev
```

The development server will start on port 3000 with HTTPS enabled for WebGPU compatibility.

#### Production Build
```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

### Usage

1. **Open PageSonic** in your browser
2. **Load a PDF** by clicking the "Open" button and selecting a file
3. **Navigate pages** using the scroll wheel or page navigation
4. **Select text** to access the context toolbar with speak options
5. **Configure TTS** in the Settings tab:
   - Choose between browser TTS or local models
   - Select your preferred voice
   - Adjust speech settings (rate, pitch)
   - Configure text chunking parameters

## TTS Models

### Supported Models

#### Browser TTS (System)
- **Source**: Built-in browser SpeechSynthesis API
- **Size**: No additional download required
- **Voices**: System-dependent voices
- **Requirements**: Browser with SpeechSynthesis support

#### Kokoro TTS (82MB)
- **Source**: ONNX model from onnx-community
- **Size**: 82MB model file
- **Voices**: af_sarah, af_nicole, am_michael, bf_emma, bf_isabella
- **Requirements**: WebGPU support required
- **Performance**: High quality with WebGPU acceleration

#### Kitten TTS (15MB)
- **Source**: Lightweight ONNX model
- **Size**: 15MB model file
- **Voices**: af_sarah, af_nicole, am_michael
- **Requirements**: CPU (WASM) or WebGPU if available
- **Performance**: Good quality, faster loading

### Model Setup
1. Download model files and place them in `public/models/`
2. Expected filenames:
   - `kokoro-82m.onnx` (Kokoro TTS model)
   - `kitten-15m.onnx` (Kitten TTS model)
3. Models are loaded on-demand when selected in settings

## Development

### Project Structure
```
pagesonic/
├── src/
│   ├── components/          # SolidJS components
│   │   ├── PDFViewer.tsx    # Main PDF viewing interface
│   │   ├── PDFPage.tsx      # Individual page rendering
│   │   ├── SelectionToolbar.tsx # Text selection controls
│   │   └── SettingsView.tsx # TTS configuration
│   ├── stores/              # State management
│   │   ├── pdf.ts           # PDF document state
│   │   └── tts.ts           # TTS engine state
│   ├── types/               # TypeScript definitions
│   ├── utils/               # Utility functions
│   └── App.tsx              # Main application component
├── public/
│   ├── models/              # TTS model files
│   └── ort/                 # ONNX Runtime Web assets
└── package.json
```

### Key Technologies
- **SolidJS**: Reactive UI framework with signals for state management
- **PDF.js**: PDF rendering and text extraction
- **ONNX Runtime Web**: Local TTS model inference
- **TypeScript**: Type-safe development
- **Vite**: Build tool and development server

### Development Commands
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
npm run type-check   # Run TypeScript type checking
```

### Development Setup
The development server is configured with:
- HTTPS with automatic certificate generation (mkcert)
- Cross-Origin headers for WebGPU compatibility
- Hot module replacement for rapid development
- Local network access for testing on different devices

## Architecture

### State Management
- **Custom Stores**: Uses SolidJS signals for reactive state management
- **PDF Store**: Manages document loading, page navigation, and text extraction
- **TTS Store**: Handles model loading, playback controls, and voice settings

### PDF Processing
- **Client-side Rendering**: PDF.js handles document parsing and rendering
- **Text Extraction**: Performed during document load for immediate TTS access
- **Metadata**: Extracts document information (title, author, etc.)

### TTS System
- **Model Loading**: ONNX models loaded on-demand with WebGPU/CPU fallback
- **Text Chunking**: Intelligent splitting of text for optimal TTS performance
- **Browser Fallback**: Graceful fallback to SpeechSynthesis when models unavailable

## Privacy

PageSonic is designed with privacy as a core principle:

### Data Processing
- **All Local**: PDF processing and TTS synthesis happen entirely in your browser
- **No External Calls**: No network requests to external servers for processing
- **No Cloud Storage**: Documents are never uploaded or stored externally

### Security
- **Cross-Origin Isolation**: Proper COOP/COEP headers for WebGPU security
- **Sandboxed Execution**: Runs in browser sandbox with standard security restrictions
- **No Persistent Storage**: Documents are processed in memory only

### Transparency
- **Open Source**: Full source code available for review
- **No Tracking**: No analytics, telemetry, or usage data collection
- **Clear Permissions**: Browser requests only necessary permissions

## Browser Compatibility

### Supported Browsers
- **Chrome/Edge 113+**: Full feature support including WebGPU
- **Firefox 102+**: PDF viewing and browser TTS supported
- **Safari 16+**: PDF viewing and browser TTS supported

### Feature Support
- **WebGPU**: Required for Kokoro TTS model (Chrome/Edge only)
- **SpeechSynthesis**: Available in most modern browsers
- **WASM**: Required for CPU-based TTS models
- **PDF.js**: Supported in all modern browsers

## Troubleshooting

### Common Issues

#### WebGPU Not Available
- Ensure you're using Chrome/Edge 113 or later
- Enable WebGPU in `chrome://flags` if needed
- Check that your hardware supports WebGPU

#### Model Loading Failures
- Verify model files are in `public/models/`
- Check file sizes match expected values
- Ensure proper file permissions

#### Browser TTS Not Working
- Check that your browser supports SpeechSynthesis
- Try refreshing voices in the Settings panel
- Verify system voices are available

### Performance Tips
- Use Kitten model for faster loading on slower connections
- Adjust chunk size based on your device performance
- Enable text chunking for better TTS performance

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

### Development Guidelines
- Follow TypeScript best practices
- Maintain privacy-first architecture
- Test across different browsers and devices
- Document new features and changes

## License

This project is licensed under the ISC License - see the LICENSE file for details.

## Acknowledgments

- **PDF.js**: Mozilla's PDF rendering library
- **ONNX Runtime**: Microsoft's ONNX inference engine
- **SolidJS**: Reactive JavaScript framework
- **Kokoro/Kitten**: Open-source TTS models

---

**PageSonic** - Your privacy, your documents, your control.