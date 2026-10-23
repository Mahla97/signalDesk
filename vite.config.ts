import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The app calls the API with relative `/api/...` paths (src/lib/api.ts). In dev
// Vite must forward those to the backend — without this the request hits the dev
// server and comes back as index.html with a 200, which `api()` parses as `{}`
// and the feed then crashes on `.filter`. Point it elsewhere (e.g. a server on
// another port) with API_PROXY_TARGET.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

// Both plugins are required: Tailwind v4 only compiles through its Vite
// plugin — removing tailwindcss() leaves the app silently unstyled.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      // The push plugin's *web* implementation imports firebase/messaging. Push
      // is delivered natively and that path never runs, so this stub keeps the
      // browser bundle from needing the whole Firebase SDK. See firebaseStub.ts.
      'firebase/messaging': fileURLToPath(new URL('./src/lib/firebaseStub.ts', import.meta.url)),
    },
  },
});
