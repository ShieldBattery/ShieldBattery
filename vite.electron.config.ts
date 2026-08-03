import dotenv from 'dotenv'
import { expand } from 'dotenv-expand'
import { resolve } from 'node:path'
import { defineConfig, type UserConfig } from 'vite'
import {
  ASSET_NAMING,
  NONCE_TOKEN,
  ROOT,
  sharedDefines,
  sharedOxc,
  sharedPlugins,
  sharedResolve,
  shellPlugin,
} from './vite.shared'

/**
 * The shell the Electron client loads, relative to {@link ROOT}. Doubles as the build entry and,
 * in development, as the path the main process fetches from the dev server to get a shell with
 * Vite's client and React Refresh preamble already injected. The main process has its own copy of
 * that URL, since it cannot import from a Vite config.
 */
const SHELL_ENTRY = 'app/index.html'
/**
 * Everything the renderer needs, in the directory the packager copies wholesale. The built shell
 * lands here too, as `index.html`; the main process reads it and fills its slots per request.
 *
 * The webpack build of the main process, its preload and the replay DB worker writes here as well,
 * which is why this build must not empty the directory.
 */
const OUT_DIR = 'app/dist'
/**
 * URL prefix the built shell's asset URLs carry. The `shieldbattery://` protocol handler already
 * serves this path out of {@link OUT_DIR}, and since there is only ever one origin here, the same
 * absolute base is correct for the shell and for references the bundle resolves itself.
 */
const ASSET_BASE = '/dist/'

/** Must agree with the origin `app/app.ts` fetches the dev shell from and admits in its CSP. */
const DEV_SERVER_PORT = 5566
const DEV_SERVER_ORIGIN = `http://localhost:${DEV_SERVER_PORT}`

/**
 * Build-time fallback for which server the client talks to. At runtime the preload script's copy of
 * `process.env` wins where it has a value (see `client/network/server-base-url.ts`), so this only
 * decides what a build with no environment set points at.
 */
function resolveServerUrl(isProd: boolean): string {
  if (process.env.SB_SERVER) {
    return process.env.SB_SERVER
  }
  if (isProd) {
    return 'https://shieldbattery.net'
  }

  // Read into a scratch object rather than `process.env`: this is the bundler's environment, and
  // the server config has no business in it.
  const parsed: Record<string, string> = {}
  expand(dotenv.config({ path: resolve(ROOT, '.env'), processEnv: parsed, quiet: true }))
  return parsed.SB_CANONICAL_HOST || 'http://localhost:5555'
}

export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
  const isProd = mode === 'production'
  const serverUrl = resolveServerUrl(isProd)

  if (command === 'serve') {
    console.log(`Using a server of ${serverUrl} by default`)
  }

  return {
    root: ROOT,
    // Only meaningful for the build. Vite reduces a base with an origin in it to its pathname when
    // serving, so there is no way to point the dev server's URLs at itself from here; the main
    // process rewrites them instead (see `app/client-shell.ts`).
    base: command === 'build' ? ASSET_BASE : '/',

    // Unlike the web client, nothing is put in front of this dev server -- it serves the shell
    // itself, and the main process asks it for one. See DEV_SHELL_URL.
    html: command === 'serve' ? { cspNonce: NONCE_TOKEN } : undefined,

    resolve: sharedResolve(isProd),
    define: sharedDefines({ isElectron: true, env: { SB_SERVER: serverUrl } }),
    oxc: sharedOxc(isProd),

    plugins: [
      ...(await sharedPlugins()),
      shellPlugin({ emittedAt: SHELL_ENTRY, destination: resolve(ROOT, OUT_DIR, 'index.html') }),
    ],

    server: {
      port: DEV_SERVER_PORT,
      // The app has this port baked into its CSP and its dev shell URL, so quietly moving to
      // another one would just produce a blank window.
      strictPort: true,
      // Makes asset URLs generated from module code absolute, so they resolve against this server
      // rather than against `shieldbattery://app`. It does *not* cover the tags the HTML transform
      // injects into the shell, which stay root-relative -- `app/client-shell.ts` handles those.
      origin: DEV_SERVER_ORIGIN,
      // The renderer's document is on a different origin than this server, so its module requests
      // are cross-origin. Vite's default only admits localhost origins, which the app's scheme is
      // not; without this every module request fails CORS and the window stays blank.
      cors: { origin: ['shieldbattery://app', /^https?:\/\/localhost(?::\d+)?$/] },
      // The page can't derive this: it would infer the HMR endpoint from its own location, which
      // is a `shieldbattery://` URL with no port.
      hmr: { protocol: 'ws', host: 'localhost', port: DEV_SERVER_PORT },
      // Vite's root is the repo root and its default ignores cover only .git, node_modules,
      // test-results and outDir. Without these the watcher also walks the Rust build directories
      // -- 60k+ files between them, rewritten continuously whenever the Rust server is running
      // alongside this one, which `local-dev` does by default.
      watch: {
        ignored: [
          '**/target/**',
          '**/app/dist/**',
          '**/server/public/**',
          '**/server/uploaded_files/**',
        ],
      },
      // Vite serves anything under the workspace root on this port, so the denylist matters.
      //
      // This *replaces* Vite's default rather than extending it, so the default has to be
      // restated here or `.env`, keys and `.git` stop being protected. The only deliberate change
      // is `.env*` in place of `.env` + `.env.*`, which additionally covers the `.env-build` at
      // the repo root. Re-check this list when upgrading Vite.
      fs: {
        deny: ['.env*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**'],
      },
    },

    build: {
      outDir: OUT_DIR,
      rollupOptions: { input: resolve(ROOT, SHELL_ENTRY), output: ASSET_NAMING },
      // Whatever Electron ships is the only runtime this bundle ever sees, and it is always newer
      // than anything worth lowering for.
      target: 'esnext',
      // The main process, preload and replay DB worker bundles live in this directory too, and
      // are built separately -- emptying it would delete them.
      emptyOutDir: false,
      // 'hidden' rather than true: the packaged app excludes *.map, so a sourceMappingURL comment
      // would point every chunk at a file that isn't there.
      sourcemap: 'hidden',
    },
  }
})
