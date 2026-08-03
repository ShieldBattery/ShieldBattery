import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'rolldown'

export interface SidecarAsset {
  /** Matches the module that does the reading, by its resolved path. */
  test: RegExp
  /** Files it reads, named as they sit next to that module (and as it asks for them). */
  files: readonly string[]
}

/**
 * Copies data files that a bundled dependency reads from its own directory at runtime.
 *
 * A `readFileSync(path.join(__dirname, 'x'))` is invisible to a bundler, since it is not an import,
 * but bundling moves the code and `__dirname` with it -- so the file has to be placed beside the
 * output. Names are preserved rather than hashed, because the reader asks for them by name.
 *
 * A dependency that does this fails only where the original package directory is absent, which is
 * to say in a packaged app rather than wherever it was built.
 */
export function sidecarAssets(assets: readonly SidecarAsset[]): Plugin {
  const emitted = new Set<string>()
  const matched = new Set<RegExp>()

  return {
    name: 'sb:sidecar-assets',

    async load(id) {
      for (const asset of assets) {
        if (!asset.test.test(id)) continue
        matched.add(asset.test)

        for (const file of asset.files) {
          if (emitted.has(file)) continue
          emitted.add(file)
          this.emitFile({
            type: 'asset',
            fileName: file,
            source: await readFile(path.join(path.dirname(id), file)),
          })
        }
      }

      return null
    },

    buildEnd(error) {
      if (error) return

      // A pattern that stops matching -- the dependency was upgraded and moved its files, or is no
      // longer reached at all -- would otherwise produce a build that only fails once packaged and
      // running. Whichever of those it is, it needs a person to look at it.
      const unmatched = assets.filter(asset => !matched.has(asset.test))
      if (unmatched.length) {
        throw new Error(
          `Sidecar assets matched no module: ${unmatched.map(a => String(a.test)).join(', ')}. ` +
            `Either the module moved, or nothing imports it any more.`,
        )
      }
    },
  }
}
