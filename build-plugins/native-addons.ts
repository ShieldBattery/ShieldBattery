import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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
  const emitted = new Set<string>()

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

        // The same addon reached from two entries resolves twice; emitting it twice is an error.
        if (!emitted.has(fileName)) {
          emitted.add(fileName)
          this.emitFile({ type: 'asset', fileName, source: contents })
        }

        return { id: `./${fileName}`, external: true }
      },
    },
  }
}
