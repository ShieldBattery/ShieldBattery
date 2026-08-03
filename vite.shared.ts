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
 * Defines both client builds share, plus whatever `import.meta.env` members the caller adds.
 *
 * Vite supplies `MODE`/`DEV`/`PROD` itself and replaces each access with a literal, which is what
 * lets development-only branches disappear rather than merely evaluate to false — an unfolded
 * branch would drag in the whole `/dev` route tree.
 *
 * Members a build doesn't define simply read as `undefined`: `client/network/server-base-url.ts`
 * reads `SB_SERVER`, which only the Electron build sets.
 */
export function sharedDefines({
  isElectron,
  env = {},
}: {
  isElectron: boolean
  env?: Record<string, string>
}): Record<string, unknown> {
  return {
    // A bare identifier rather than an `import.meta.env` member: the Electron main process reads it
    // too, and that bundle is CommonJS, where there is no `import.meta` to read it from.
    IS_ELECTRON: isElectron,
    // styled-components reads this bare identifier to nonce the <style> tags it injects. Our
    // style-src has no 'unsafe-inline', so without it every styled component fails to apply.
    // eslint-disable-next-line camelcase
    __webpack_nonce__: 'window.SB_CSP_NONCE',
    ...Object.fromEntries(
      Object.entries({ SB_VERSION: packageJson.version, ...env }).map(([key, value]) => [
        `import.meta.env.${key}`,
        JSON.stringify(value),
      ]),
    ),
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
      // Left on the default `**/*.svg?react`: an SVG is a component only where the import asks for
      // one, which keeps a dependency's SVG an image (turning one into JSX would break its
      // importer) and leaves `*.svg` free to mean a URL, as `vite/client` types it.
      //
      // No `svgoConfig`: this chain is `@svgr/core` plus `@svgr/plugin-jsx`, with no SVGO, so
      // nothing rewrites the markup and attributes like `viewBox` survive untouched. Installing
      // `@svgr/plugin-svgo` would change that — SVGO's default preset strips `viewBox`, so it
      // would need `preset-default` with a `removeViewBox: false` override.
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
