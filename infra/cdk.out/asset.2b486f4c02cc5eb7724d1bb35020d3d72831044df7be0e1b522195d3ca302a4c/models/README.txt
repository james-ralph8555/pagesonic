Place ONNX TTS models here for offline use.

Expected filenames (matching the UI):
- kokoro-82m.onnx     (Kokoro TTS 82M WebGPU model)
- kitten-15m.onnx     (Kitten TTS ~15M model)

Notes:
- Kokoro requires WebGPU. On devices without WebGPU, loading will fail.
- Kitten can run on CPU (WASM) or WebGPU if available.
- Files are large; consider serving with HTTP range requests for progressive download.

You can obtain models from their respective sources, e.g., Kokoro from onnx-community on Hugging Face.
