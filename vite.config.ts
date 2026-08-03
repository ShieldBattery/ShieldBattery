import browserslist from 'browserslist'
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

    resolve: sharedResolve(isProd),
    define: sharedDefines({ isElectron: false }),
    oxc: sharedOxc(isProd),

    plugins: [
      ...(await sharedPlugins()),
      shellPlugin({ emittedAt: 'index.html', destination: resolve(ROOT, SHELL_OUT) }),
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
        output: ASSET_NAMING,
      },
    },
  }
})
