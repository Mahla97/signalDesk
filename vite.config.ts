import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The app calls the API with relative `/api/...` paths (src/lib/api.ts). In dev
// Vite must forward those to the backend — without this the request hits the dev
// server and comes back as index.html with a 200, which `api()` parses as `{}`
// and the feed then crashes on `.filter`. Point it elsewhere (e.g. a server on
// another port) with API_PROXY_TARGET.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

/** A Play build must talk HTTPS and must not contain the admin panel route. */
function assertPlayBuildSafe(env: Record<string, string>): void {
  if (env.VITE_STORE_BUILD !== 'play') return;
  if (env.VITE_ADMIN_PATH) {
    throw new Error('Play build: unset VITE_ADMIN_PATH — the admin panel must not ship in the app.');
  }
  if (!(env.VITE_API_BASE_URL ?? '').startsWith('https://')) {
    throw new Error('Play build: VITE_API_BASE_URL must be an https:// URL.');
  }
}

// Both plugins are required: Tailwind v4 only compiles through its Vite
// plugin — removing tailwindcss() leaves the app silently unstyled.
export default defineConfig(({ mode }) => {
  assertPlayBuildSafe(loadEnv(mode, process.cwd(), 'VITE_'));
  return {
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
  };
});
