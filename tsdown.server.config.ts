import { execFileSync } from 'node:child_process'
import { defineConfig } from 'tsdown'

// Asserts that decorator metadata actually made it into the compiled output, in a fresh node
// process resembling the runtime (CJS, reflect polyfill loaded first). tsyringe resolves
// constructor dependencies through design:paramtypes; a transform that quietly stops emitting it
// produces a build that only fails at boot. The unit suite can't cover this -- vitest transforms
// test files itself, so no test file ever passes through this build.
const METADATA_CHECK = `
  require('core-js/proposals/reflect-metadata')
  const { WebsocketServer } = require('./server-dist/server/websockets.js')
  const types = Reflect.getMetadata('design:paramtypes', WebsocketServer) ?? []
  const names = types.map(t => t && t.name)
  if (types.length !== 7 || !names.includes('RequestSessionLookup')) {
    throw new Error(
      'design:paramtypes missing or wrong on compiled WebsocketServer: ' + JSON.stringify(names),
    )
  }
`

// Compiles the Node server ahead of time: `server/` + `common/` become a mirrored CJS tree under
// `server-dist/`, and production runs `node server-dist/server/app.js` with no runtime
// transpiler. Development still runs from source through a register hook, so this build is a
// production (and integration-test image) concern only.
export default defineConfig({
  entry: [
    'server/**/*.ts',
    'common/**/*.ts',
    '!**/*.test.ts',
    // Vitest-only helpers (fakes/mocks); `server/testing/` itself stays in -- the fake external
    // services there run inside the production image during integration tests.
    '!common/testing/**',
    '!server/lib/**/testing/**',
    '!server/testing/google/**',
  ],
  outDir: 'server-dist',
  format: 'cjs',
  platform: 'node',
  // Mirror the source layout file-for-file instead of bundling. `__dirname`-anchored paths keep
  // meaning what they mean, and the worker entries (`launch-worker`, `map-parse-worker`,
  // `replay-worker`) stay individually loadable files.
  unbundle: true,
  // Extensionless CJS `require`/`require.resolve` resolution only searches `.js`, so the worker
  // spawn sites break on the `.cjs` names this would otherwise default to on node.
  fixedExtension: false,
  sourcemap: true,
  // Everything in the tree is an entry, so there is no dead code to shake -- but tree shaking
  // could misjudge a side-effect-only import, and imports like `./http-apis` exist purely for
  // their tsyringe registration side effects.
  treeshake: false,
  // node_modules stay external requires: native addons (bcrypt) and wasm-adjacent loaders
  // (@shieldbattery/broodrep) load from their own package directories at runtime.
  deps: { neverBundle: true },
  checks: { legacyCjs: false },
  // Modules mixing default and named exports get flagged for the sake of external consumers who
  // would need `.default`. Every consumer of these modules is inside this same build with
  // matching interop helpers (verified via runtime probe), so the warning doesn't apply.
  suppressWarnings: ['default exports together'],
  // Per-file size reporting over hundreds of mirrored files is noise.
  report: false,
  // The runtime assets the compiled code reads through `__dirname`-relative paths, mirrored to
  // the same places so those paths keep working. `client-shell/` and `public/scripts/` are
  // `vite build` (web client) output, so that build must run before this one.
  copy: [
    { from: 'server/email', to: 'server-dist/server', flatten: false },
    { from: 'server/client-shell', to: 'server-dist/server', flatten: false },
    { from: 'server/public', to: 'server-dist/server', flatten: false },
  ],
  onSuccess: () => {
    execFileSync(process.execPath, ['-e', METADATA_CHECK], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: {
        ...process.env,
        // The check only requires modules, but some of them validate their environment at module
        // scope, more strictly in production. Metadata emission happened at compile time, so the
        // check's runtime environment can be the lenient one with placeholder values.
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://metadata-check',
      },
    })
  },
})
