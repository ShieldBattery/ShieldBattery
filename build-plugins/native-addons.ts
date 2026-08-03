import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'rolldown'

/**
 * Ships the native addons (`.node`) that bundled dependencies require, since the packaged app
 * carries no `node_modules` for them to be resolved from.
 *
 * Each addon is copied next to the bundles under `native/`, named by its content so two
 * dependencies wanting the same addon share one copy, and the import becomes a plain relative
 * `require` of that copy. Leaving the require in the output rather than resolving it at build time
 * is the point: an addon is a binary the bundler has nothing useful to do with, and Node (and
 * Electron, which extracts it from the asar on demand) can load it directly.
 */
export function nativeAddons(): Plugin {
  /** Addon copies this build needs, keyed by output-relative name. */
  const wanted = new Map<string, string>()

  return {
    name: 'sb:native-addons',

    resolveId: {
      filter: { id: /\.node$/ },
      async handler(source, importer, options) {
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
        if (!resolved || resolved.external) {
          return resolved
        }

        const contents = await readFile(resolved.id)
        const hash = createHash('sha256').update(contents).digest('hex').slice(0, 32)
        const fileName = `native/${path.basename(resolved.id, '.node')}-${hash}.node`
        // The same addon reached from two entries resolves twice.
        wanted.set(fileName, resolved.id)

        return { id: `./${fileName}`, external: true }
      },
    },

    /**
     * Copied here rather than emitted as a build asset so that an addon already present can be left
     * alone. The name carries a hash of the contents, so a file that is already there is by
     * definition the right one, and rewriting it would fail whenever a running app has it loaded --
     * an operating system that locks mapped libraries will not allow the overwrite, and the build
     * dies partway with a broken output directory. A rebuild while the app is running is routine.
     */
    async writeBundle(options) {
      const outDir = options.dir
      if (!outDir) return

      await Promise.all(
        Array.from(wanted, async ([fileName, sourcePath]) => {
          const destination = path.resolve(outDir, fileName)
          const source = await stat(sourcePath)
          const existing = await stat(destination).catch(() => undefined)
          if (existing?.size === source.size) return

          await mkdir(path.dirname(destination), { recursive: true })
          await copyFile(sourcePath, destination)
        }),
      )
    },
  }
}
