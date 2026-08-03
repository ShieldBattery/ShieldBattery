import dotenv from 'dotenv'
import path from 'node:path'
import { defineConfig, type OutputOptions, type RolldownOptions } from 'rolldown'
import { nativeAddons } from './build-plugins/native-addons'
import { securityImpl } from './build-plugins/security-impl'
import { sidecarAssets } from './build-plugins/sidecar-assets'

const ROOT = import.meta.dirname
/**
 * Everything the packaged app runs, in one directory. The renderer build writes here too (see
 * vite.electron.config.ts), and the packager copies the directory whole, so `__dirname` means the
 * same thing during development as it does once installed.
 */
const OUT_DIR = path.join(ROOT, 'app', 'dist')

const isProd = process.env.NODE_ENV === 'production'

/**
 * Build-only settings, read into a scratch object rather than `process.env`: these belong to the
 * build, not to the process running it.
 */
const buildEnv: Record<string, string> = {}
dotenv.config({ path: path.join(ROOT, '.env-build'), processEnv: buildEnv, quiet: true })

const analyticsId = process.env.SB_ANALYTICS_ID ?? buildEnv.SB_ANALYTICS_ID ?? ''
const securityImplPath =
  process.env.SB_BUILD_SECURITY_CLIENTS_IMPL ?? buildEnv.SB_BUILD_SECURITY_CLIENTS_IMPL

const output: OutputOptions = {
  dir: OUT_DIR,
  format: 'cjs',
  entryFileNames: '[name].js',
  // Distinct from the renderer's `.chunk.js`, so the two builds sharing this directory can't
  // collide and it stays obvious which side of the app a file belongs to.
  chunkFileNames: '[name].appchunk.js',
  // 'hidden' rather than true: the packaged app excludes *.map, so a sourceMappingURL comment
  // would point every chunk at a file that isn't there.
  sourcemap: 'hidden',
}

const shared: RolldownOptions = {
  platform: 'node',
  // Electron's own modules come from the runtime, not from the bundle.
  external: ['electron'],
  transform: {
    // Legacy decorators and their metadata, which tsyringe resolves constructor dependencies from,
    // are picked up from tsconfig's `experimentalDecorators`/`emitDecoratorMetadata`. Setting them
    // here as well only earns a warning that the two disagree about who owns the setting.
    define: {
      IS_ELECTRON: 'true',
      SB_ANALYTICS_ID: JSON.stringify(analyticsId),
      // Only the exact member, so the rest of `process.env` stays readable at runtime.
      'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
    },
  },
  output,
}

export default defineConfig([
  {
    ...shared,
    input: {
      index: path.join(ROOT, 'app/startup.js'),
      // The replay library's DB, watcher and parser run in a worker thread; this is its entry,
      // loaded via `new Worker(...)` from the main bundle.
      'db-worker': path.join(ROOT, 'app/replay-library/worker/db-worker.ts'),
    },
    plugins: [
      nativeAddons(),
      securityImpl(securityImplPath),
      sidecarAssets([
        // The replay parser is compiled to WebAssembly, which its Node entry loads by reading the
        // file next to itself.
        { test: /broodrep[\\/]pkg-node[\\/]broodrep_wasm\.js$/, files: ['broodrep_wasm_bg.wasm'] },
      ]),
    ],
  },
  {
    ...shared,
    input: { preload: path.join(ROOT, 'app/preload.js') },
    // Deliberately its own build rather than a third entry above: a sandboxed preload has no
    // `require` for sibling files, so it cannot be allowed to share a chunk with anything.
    plugins: [],
  },
])
