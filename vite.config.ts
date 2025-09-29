import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { resolve } from 'path'

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['solid-js'],
          pdf: ['pdfjs-dist'],
          tts: ['onnxruntime-web'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['solid-js', 'pdfjs-dist'],
  },
  define: {
    global: 'globalThis',
  },
  publicDir: 'public',
})