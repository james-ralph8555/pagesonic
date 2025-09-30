import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import mkcert from 'vite-plugin-mkcert'
import { resolve } from 'path'
import os from 'node:os'

// Build a list of hosts/IPs for mkcert so the cert is valid for LAN
const nets = os.networkInterfaces()
const lanIps = Object.values(nets).flatMap(v => (v || [])).filter((n: any) => n && n.family === 'IPv4' && !n.internal).map((n: any) => n.address)
const host = os.hostname()
const mdns = host.includes('.') ? host : `${host}.local`
const mkcertHosts = Array.from(new Set([
  'localhost', '127.0.0.1', '::1',
  host, mdns,
  ...lanIps,
]))

export default defineConfig({
  plugins: [
    solid(),
    // HTTPS for trustworthy origin on LAN
    mkcert({ hosts: mkcertHosts, force: true }),
    // Nicely print proper HTTPS URLs on startup
    {
      name: 'print-proper-https-urls',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          const httpsEnabled = !!server.config.server.https
          const protocol = httpsEnabled ? 'https' : 'http'
          const port = server.config.server.port || 3000
          const hostname = host
          const mdnsName = mdns
          const lanIp = lanIps[0]
          const urls = [
            `${protocol}://localhost:${port}/`,
            `${protocol}://${mdnsName}:${port}/`,
            lanIp ? `${protocol}://${lanIp}:${port}/` : null,
          ].filter(Boolean) as string[]
          const banner = `Dev over HTTPS with COOP/COEP. Use:\n  - ${urls.join('\n  - ')}\nCert SANs: ${mkcertHosts.join(', ')}`
          console.log('\x1b[36m%s\x1b[0m', banner)
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
    // Prefer using ORT with external WASM/ESM assets in /public/ort
    conditions: ['onnxruntime-web-use-extern-wasm'],
  },
  server: {
    port: 3000,
    // Expose on LAN with HTTPS for trustworthy origin
    host: true,
    https: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
  preview: {
    port: 3000,
    host: true,
    https: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
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
    exclude: ['onnxruntime-web'],
  },
  define: {
    global: 'globalThis',
  },
  publicDir: 'public',
})
