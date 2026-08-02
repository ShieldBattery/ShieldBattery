import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import browserslist from 'browserslist'
import jotai from 'jotai-rolldown'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
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
 * assets URL (which may be a CDN origin) when it serves the shell.
 *
 * References *inside* the bundle are made relative instead (see `experimental.renderBuiltUrl`),
 * because a baked-in absolute base would be resolved against the document rather than the module
 * that uses it. That splits a CDN deploy in two: `import()` resolves relative to the importing
 * module and hits the CDN, while the matching `<link rel=modulepreload>` and async-chunk
 * stylesheets would point at the origin -- fetching every lazy chunk twice, and never serving its
 * CSS from the CDN. It fails silently, since the origin does serve those files.
 */
const ASSET_BASE = '/scripts/'

/**
 * Stand-in nonce for the tags Vite injects when serving. Unlike the build's output, those include
 * inline scripts (the React Refresh preamble), which our CSP will not run without a nonce. The
 * server swaps this token for the request's real nonce. Build output needs none of this — see
 * {@link shellPlugin}.
 */
const NONCE_TOKEN = '__SB_CSP_NONCE__'

/**
 * Translates the `browserslist` key in package.json into esbuild-style target strings so the
 * browser support matrix has exactly one definition.
 *
 * Only engines that version themselves *as* an esbuild target can be translated: Android
 * Chrome/WebView and Opera Mobile use Chrome's and Opera's numbering, so they fold in. Engines
 * that number independently cannot, and are dropped rather than mistranslated — Samsung Internet
 * 29 is Chromium 125, not Chrome 29. Today that only affects Samsung Internet, whose supported
 * releases sit well above the Chrome floor and so would not tighten the target anyway; if one of
 * these ever became the binding constraint, the honest fix is to name it in the browserslist
 * query rather than infer it here.
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
 * Relocates the built shell out of the asset directory, which is CDN-cached as immutable and so is
 * no place for a file the server re-reads and patches per request.
 *
 * Deliberately does not stamp CSP nonces onto the tags Vite emits. Everything it writes into the
 * shell is an external `<script src>`, `<link rel=modulepreload>` or `<link rel=stylesheet>`, all
 * of which our `script-src`/`style-src` already admit by origin. Only inline content needs a
 * nonce, and the only inline script or style in a rendered page is the server's own (see
 * `server/lib/client-shell/`). If a stricter nonce-only CSP is ever adopted -- dropping `'self'`
 * in favour of `'strict-dynamic'` -- that stops being true and these tags will need stamping.
 */
function shellPlugin(): Plugin {
  return {
    name: 'sb:shell',

    async writeBundle(options) {
      const outDir = options.dir
      if (!outDir) return

      const emitted = resolve(outDir, 'index.html')
      const destination = resolve(ROOT, SHELL_OUT)
      const html = await readFile(emitted, 'utf8')
      // The destination is build output and therefore gitignored, so a fresh checkout won't have
      // it -- which is every CI and container build.
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, html, { encoding: 'utf8', flush: true })
      await rm(emitted)
    },
  }
}

export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
  const isProd = mode === 'production'

  return {
    root: ROOT,
    base: ASSET_BASE,

    experimental: {
      // Keep the shell's URLs absolute so the server can rewrite them to the public assets URL,
      // but make every reference the bundle resolves itself relative to the importing module. See
      // ASSET_BASE for what an absolute base costs on a CDN deploy.
      renderBuiltUrl: (_filename, { hostType }) =>
        hostType === 'html' ? undefined : { relative: true },
    },
    // The server owns the shell; Vite only needs to transform it.
    appType: 'custom',

    // Only when serving: see NONCE_TOKEN. Setting it for builds would put nonce attributes on
    // output that doesn't need them.
    html: command === 'serve' ? { cspNonce: NONCE_TOKEN } : undefined,

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
      // Each member is defined by its full access path *and* the base object is defined as a
      // fallback. Both halves earn their place:
      //
      // The dotted keys are what make dead code actually disappear. Replacing only the base leaves
      // `({NODE_ENV:'production'}).NODE_ENV !== 'production'`, which rolldown does not constant
      // fold, so development-only branches still ship (harmless but large — it drags in the whole
      // `/dev` route tree). webpack's DefinePlugin substituted the full member expression, which
      // folds; this reproduces that.
      //
      // The base object covers members nothing here defines — `client/network/server-base-url.ts`
      // reads `__WEBPACK_ENV.SB_SERVER` — which would otherwise be a ReferenceError rather than
      // the `undefined` it was under webpack.
      //
      // Values are deliberately pre-stringified only in the dotted form: Vite JSON-stringifies a
      // non-string value whole, so stringifying the leaves of the object as well would double
      // encode them into `'"production"'`.
      '__WEBPACK_ENV.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
      '__WEBPACK_ENV.VERSION': JSON.stringify(packageJson.version),
      __WEBPACK_ENV: {
        NODE_ENV: isProd ? 'production' : 'development',
        VERSION: packageJson.version,
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
        // Bare `.svg` imports are React components here, so every SVG goes through the transform
        // rather than only `?react`-suffixed ones.
        //
        // No `svgoConfig`: this chain is `@svgr/core` plus `@svgr/plugin-jsx`, with no SVGO, so
        // nothing rewrites the markup and attributes like `viewBox` survive untouched. Installing
        // `@svgr/plugin-svgo` would change that — SVGO's default preset strips `viewBox`, so it
        // would need `preset-default` with a `removeViewBox: false` override.
        include: '**/*.svg',
        // A dependency's SVG is an image, not one of our components; turning one into JSX would
        // break its importer. Nothing imports one today, so this only forecloses the trap.
        exclude: '**/node_modules/**',
      }),
      jotai(),
      graphqlOptimizer(ROOT),
      // React Compiler is the only thing left on Babel, and only until oxc's Rust port becomes
      // reachable from released Vite (oxc#24542).
      //
      // Notably absent: core-js injection. `babel-plugin-polyfill-corejs3` produces a bundle that
      // throws on load, because core-js is CommonJS and rolldown's wrapper for it lives in the
      // runtime chunk, while the injected side-effect imports hoist *into* that same chunk -- a
      // circular import that leaves the wrappers uninitialized when they're called. Chunk grouping
      // doesn't break the cycle, and the other injection modes either need `core-js-pure` (which
      // changes semantics) or silently emit nothing.
      //
      // Dropping it costs nothing measurable today: with injection on, exactly seven polyfills
      // were emitted (array.includes, four iterator helpers, set.union, uint8-array.to-hex) and
      // all seven are false positives from babel matching method *names* -- nothing here calls
      // `.union()`, `Iterator.from` or `.toHex()`, and `.includes`/`.every`/`.filter`/`.find`/
      // `.forEach` on arrays predate every browser we target. `build.target` still lowers syntax.
      //
      // What this does remove is the safety net: a newly-used API that our floor lacks will now
      // simply break there rather than being polyfilled. `@core-js/unplugin` is the intended fix
      // once core-js v4 ships it, being rolldown-native rather than an injection of CJS imports.
      await babel({
        presets: [reactCompilerPreset()],
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
      // 'hidden' rather than true: the deploy sync excludes *.map from the CDN precisely because
      // the bundles don't reference them, so emitting sourceMappingURL comments would point every
      // production chunk at a 404. The maps still get generated, and stay in the server image.
      sourcemap: 'hidden',
      // No build manifest. Nothing reads one now that the server takes asset tags from the shell
      // HTML, and it would write a mutable file into a directory the CDN caches as immutable and
      // that `find_stale_scripts.py` never prunes. Pass `--manifest` ad hoc for bundle analysis.
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
