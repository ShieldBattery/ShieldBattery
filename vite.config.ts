import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import browserslist from 'browserslist'
import jotai from 'jotai-rolldown'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin, type UserConfig } from 'vite'
import svgr from 'vite-plugin-svgr'
import { graphqlOptimizer } from './build-plugins/graphql-optimizer'
import packageJson from './package.json' with { type: 'json' }

const ROOT = import.meta.dirname

/**
 * Where the compiled JS/CSS lands. Everything in here is content-hashed and gets uploaded to the
 * CDN with a year-long immutable cache by `server/update_server.sh`, so nothing that changes
 * without changing its name may be written here (notably the shell HTML, see SHELL_OUT).
 */
const ASSET_OUT = 'server/public/scripts'
/**
 * Where the shell HTML lands. Deliberately outside {@link ASSET_OUT}: the server re-reads this
 * file and patches it per request, which is incompatible with immutable caching.
 */
const SHELL_OUT = 'server/client-shell/index.html'
/**
 * Prefix for asset URLs written into the shell. The server rewrites this to the configured public
 * assets URL (which may be a CDN origin) when it serves the shell. Lazy chunks need no rewriting:
 * native ESM resolves them relative to the importing module's URL.
 */
const ASSET_BASE = '/scripts/'

/** Placeholder the server replaces with the request's CSP nonce. */
const NONCE_TOKEN = '__SB_CSP_NONCE__'

/**
 * Translates the `browserslist` key in package.json into esbuild-style target strings so the
 * browser support matrix has exactly one definition. Engines esbuild has no target for (Samsung
 * Internet, Android WebView, ...) fold into the engine they are built on.
 */
function browserslistToTargets(): string[] {
  // browserslist engine name -> esbuild engine name. A Map rather than an object because these
  // keys are browserslist's vocabulary, and half of them aren't valid identifiers here.
  const ESBUILD_NAMES = new Map([
    ['chrome', 'chrome'],
    ['and_chr', 'chrome'],
    ['android', 'chrome'],
    ['edge', 'edge'],
    ['firefox', 'firefox'],
    ['and_ff', 'firefox'],
    ['safari', 'safari'],
    ['ios_saf', 'ios'],
    ['opera', 'opera'],
    ['op_mob', 'opera'],
  ])

  const minimums = new Map<string, number[]>()
  for (const entry of browserslist(undefined, { path: ROOT })) {
    const [browser, rawVersion] = entry.split(' ')
    const esbuildName = ESBUILD_NAMES.get(browser)
    if (!esbuildName) continue

    // Ranges like "15.0-15.6" describe a span of releases; the low end is what we must support.
    const version = rawVersion.split('-')[0].split('.').map(Number)
    if (version.some(Number.isNaN)) continue

    const current = minimums.get(esbuildName)
    if (!current || compareVersions(version, current) < 0) {
      minimums.set(esbuildName, version)
    }
  }

  return Array.from(minimums, ([name, version]) => `${name}${version.join('.')}`).sort()
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Adds a nonce placeholder to every tag Vite emits into the shell and relocates the shell out of
 * the asset directory. Stamping here rather than matching tags in the finished HTML means tags
 * added by future Vite versions can't silently escape the CSP.
 */
function shellPlugin(): Plugin {
  return {
    name: 'sb:shell',

    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(
          /<(script|style|link)\b(?![^>]*\bnonce=)/g,
          `<$1 nonce="${NONCE_TOKEN}"`,
        )
      },
    },

    async writeBundle(options) {
      const outDir = options.dir
      if (!outDir) return

      const emitted = resolve(outDir, 'index.html')
      const destination = resolve(ROOT, SHELL_OUT)
      const html = await readFile(emitted, 'utf8')
      await writeFile(destination, html, { encoding: 'utf8', flush: true })
      await rm(emitted)
    },
  }
}

/** The installed core-js version, so only polyfills that release actually has get injected. */
const CORE_JS_VERSION = packageJson.dependencies['core-js'].replace(/^[^\d]*/, '')

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  const isProd = mode === 'production'

  return {
    root: ROOT,
    base: ASSET_BASE,
    // The server owns the shell; Vite only needs to transform it.
    appType: 'custom',

    resolve: {
      alias: isProd
        ? [
            // Keep the development-only devtools out of production bundles. The import in
            // `client/jotai-store.ts` is deliberately static, so tree shaking alone won't drop it.
            {
              find: /^jotai-devtools$/,
              replacement: resolve(ROOT, 'client/debug/jotai-devtools-stub.ts'),
            },
            {
              find: /^jotai-devtools\/styles\.css$/,
              replacement: resolve(ROOT, 'client/debug/empty.css'),
            },
          ]
        : [],
    },

    define: {
      IS_ELECTRON: false,
      // styled-components reads this bare identifier to nonce the <style> tags it injects. Our
      // style-src has no 'unsafe-inline', so without it every styled component fails to apply.
      // eslint-disable-next-line camelcase
      __webpack_nonce__: 'window.SB_CSP_NONCE',
      __WEBPACK_ENV: {
        NODE_ENV: JSON.stringify(isProd ? 'production' : 'development'),
        VERSION: JSON.stringify(packageJson.version),
      },
    },

    oxc: {
      plugins: {
        styledComponents: {
          displayName: true,
          fileName: true,
          // Bakes a componentId into every component so class names agree between a server render
          // and the client one. There is no server render here, and leaving it off is only safe
          // because `displayName`/`fileName` are on: styled-components then derives the id from
          // the (file-qualified, therefore unique) display name instead of a creation counter, so
          // ids stay stable anyway. Turning either of those off means turning this back on.
          ssr: false,
          minify: isProd,
        },
      },
    },

    plugins: [
      react(),
      svgr({
        include: '**/*.svg',
        svgrOptions: { svgoConfig: { plugins: [{ name: 'removeViewBox', active: false }] } },
      }),
      jotai(),
      graphqlOptimizer(ROOT),
      await babel({
        presets: [reactCompilerPreset()],
        plugins: [
          // Injects the core-js polyfills each file actually needs, for the browsers in the
          // package.json `browserslist` key. This is the plugin @babel/preset-env itself uses for
          // `useBuiltIns: 'usage'`.
          ['polyfill-corejs3', { method: 'usage-global', version: CORE_JS_VERSION }],
        ],
        exclude: [/[\\/]node_modules[\\/]/],
      }),
      shellPlugin(),
    ],

    build: {
      outDir: ASSET_OUT,
      target: browserslistToTargets(),
      // The asset directory holds output from previous builds that remote clients may still be
      // loading; pruning it is `find_stale_scripts.py`'s job at deploy time, not the bundler's.
      emptyOutDir: false,
      manifest: true,
      sourcemap: true,
      rollupOptions: {
        output: {
          // Flat and content-hashed, which is what the deploy sync and its stale-object pruning
          // expect to find under the scripts prefix.
          entryFileNames: '[name].[hash].js',
          chunkFileNames: '[name].[hash].chunk.js',
          assetFileNames: '[name].[hash][extname]',
        },
      },
    },
  }
})
