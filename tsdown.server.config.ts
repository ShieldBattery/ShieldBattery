import { defineConfig } from 'tsdown'

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
})
