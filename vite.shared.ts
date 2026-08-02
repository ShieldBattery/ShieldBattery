import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import jotai from 'jotai-rolldown'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Plugin, UserConfig } from 'vite'
import svgr from 'vite-plugin-svgr'
import { graphqlOptimizer } from './build-plugins/graphql-optimizer'
import packageJson from './package.json' with { type: 'json' }

/** Repo root, which is the Vite root for both client builds. */
export const ROOT = import.meta.dirname

/**
 * Stand-in nonce for the tags Vite injects when serving. Unlike the build's output, those include
 * inline scripts (the React Refresh preamble), which our CSP will not run without a nonce. Whoever
 * serves the shell swaps this token for the request's real nonce.
 *
 * Setting `html.cspNonce` also makes Vite emit a `<meta property="csp-nonce" nonce="...">`, which
 * is where its dev client reads the value it stamps onto the `<style>` elements it injects for CSS
 * HMR. Our `style-src` has no `'unsafe-inline'`, so without that meta those styles are blocked.
 */
export const NONCE_TOKEN = '__SB_CSP_NONCE__'

/**
 * Flat and content-hashed. Both builds want this: the web deploy sync uploads its output under a
 * single prefix with a year-long immutable cache and prunes by name, and the Electron client serves
 * its output from a directory the packager copies wholesale.
 */
export const ASSET_NAMING = {
  entryFileNames: '[name].[hash].js',
  chunkFileNames: '[name].[hash].chunk.js',
  assetFileNames: '[name].[hash][extname]',
}

/**
 * Builds the `__WEBPACK_ENV` defines. Each member is defined by its full access path *and* the base
 * object is defined as a fallback. Both halves earn their place:
 *
 * The dotted keys are what make dead code actually disappear. Replacing only the base leaves
 * `({NODE_ENV:'production'}).NODE_ENV !== 'production'`, which rolldown does not constant fold, so
 * development-only branches still ship (harmless but large — it drags in the whole `/dev` route
 * tree). webpack's DefinePlugin substituted the full member expression, which folds; this
 * reproduces that.
 *
 * The base object covers members this build doesn't define — the web client reads
 * `__WEBPACK_ENV.SB_SERVER`, which only the Electron build sets — so those read as the `undefined`
 * they were under webpack rather than throwing a ReferenceError.
 *
 * Values are stringified only in the dotted form: Vite JSON-stringifies a non-string value whole,
 * so stringifying the leaves of the object as well would double encode them into `'"production"'`.
 */
export function webpackEnvDefines(
  isProd: boolean,
  extra: Record<string, string> = {},
): Record<string, unknown> {
  const env: Record<string, string> = {
    NODE_ENV: isProd ? 'production' : 'development',
    VERSION: packageJson.version,
    ...extra,
  }

  return {
    ...Object.fromEntries(
      Object.entries(env).map(([key, value]) => [`__WEBPACK_ENV.${key}`, JSON.stringify(value)]),
    ),
    __WEBPACK_ENV: env,
  }
}

/** Defines both client builds share, plus whatever `__WEBPACK_ENV` members the caller adds. */
export function sharedDefines({
  isProd,
  isElectron,
  env = {},
}: {
  isProd: boolean
  isElectron: boolean
  env?: Record<string, string>
}): Record<string, unknown> {
  return {
    IS_ELECTRON: isElectron,
    // styled-components reads this bare identifier to nonce the <style> tags it injects. Our
    // style-src has no 'unsafe-inline', so without it every styled component fails to apply.
    // eslint-disable-next-line camelcase
    __webpack_nonce__: 'window.SB_CSP_NONCE',
    ...webpackEnvDefines(isProd, env),
  }
}

/** Keeps the development-only devtools out of production bundles. */
export function sharedResolve(isProd: boolean): UserConfig['resolve'] {
  return {
    alias: isProd
      ? [
          // The import in `client/jotai-store.ts` is deliberately static, so tree shaking alone
          // won't drop it.
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
  }
}

export function sharedOxc(isProd: boolean): UserConfig['oxc'] {
  return {
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
  }
}

/**
 * The plugin chain both client builds run. They compile the same sources, so the only thing that
 * varies between them is where the output goes and what the defines say.
 *
 * Returns Vite's loose `PluginOption` rather than `Plugin[]`: `@rolldown/plugin-babel` is typed
 * against rolldown's own `Plugin`, which is structurally incompatible with Vite's re-export of it.
 */
export async function sharedPlugins(): Promise<NonNullable<UserConfig['plugins']>> {
  return [
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
  ]
}

/**
 * Moves the HTML entry Vite emitted to where the thing that serves it expects to find it.
 *
 * Vite writes the entry at its path relative to the Vite root, which for a shell that doesn't sit
 * at the root means a nested directory nobody wants. It also has to leave the asset directory in
 * the web build's case, where that directory is CDN-cached as immutable and so is no place for a
 * file the server re-reads and patches per request.
 *
 * Deliberately does not stamp CSP nonces onto the tags Vite emits. Everything it writes into a
 * built shell is an external `<script src>`, `<link rel=modulepreload>` or `<link rel=stylesheet>`,
 * all of which our `script-src`/`style-src` already admit by origin. Only inline content needs a
 * nonce, and the only inline script or style in a rendered page is one the server put there. If a
 * stricter nonce-only CSP is ever adopted -- dropping `'self'` in favour of `'strict-dynamic'` --
 * that stops being true and these tags will need stamping.
 */
export function shellPlugin({
  emittedAt,
  destination,
}: {
  /** Path of the emitted HTML, relative to the build's `outDir`. */
  emittedAt: string
  /** Absolute path to move it to. */
  destination: string
}): Plugin {
  return {
    name: 'sb:shell',

    async writeBundle(options) {
      const outDir = options.dir
      if (!outDir) return

      const emitted = resolve(outDir, emittedAt)
      const html = await readFile(emitted, 'utf8')
      // The destination is build output and therefore gitignored, so a fresh checkout won't have
      // it -- which is every CI and container build.
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, html, { encoding: 'utf8', flush: true })
      await rm(emitted)

      // A shell that didn't sit at the Vite root left the directories of its source path behind.
      const emittedDir = dirname(emitted)
      if (emittedDir !== resolve(outDir)) {
        await rm(emittedDir, { recursive: true })
      }
    },
  }
}
