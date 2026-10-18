import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'rolldown'
import type { ThirdPartyLicensesFile, ThirdPartyPackage } from '../common/third-party-licenses'

/**
 * Licenses we're able to ship under. A package qualifies if its declared expression can be
 * satisfied using only these (any one side of an `OR`, every side of an `AND`).
 */
const ALLOWED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
])

/**
 * Packages whose manifest doesn't declare a usable SPDX expression, mapped to the one their license
 * files actually grant. Each entry should be checked against the package's license text.
 */
const CLARIFIED_LICENSES = new Map<string, string>([
  // Declares nothing in its manifest, but its LICENSE file and README are MIT.
  ['ruta3', 'MIT'],
])

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([.\-_].*)?$/i

/**
 * Packages that bundle other packages' code into their own, mapped to the directory holding one
 * subdirectory per vendored package. Those subdirectories' license files are recorded too.
 */
const VENDOR_DIRS = new Map<string, string>([['victory-vendor', 'lib-vendor']])

/**
 * Records every third-party package that ends up in the bundle, along with its license and notice
 * files, and writes that out as a {@link ThirdPartyLicensesFile} for the client's licenses page.
 * Packages are found from the modules in the final chunks, so this lists what actually ships rather
 * than everything in `package.json`.
 *
 * The build fails if a bundled package's license isn't one we can ship under (see
 * {@link ALLOWED_LICENSES}), or can't be determined at all.
 */
export function thirdPartyLicenses({
  build,
  destination,
}: {
  /** Name for the build this describes, recorded in the output. */
  build: string
  /** Absolute path of the JSON file to write. */
  destination: string
}): Plugin {
  let output: ThirdPartyLicensesFile | undefined

  return {
    name: 'sb:third-party-licenses',

    async generateBundle(_options, bundle) {
      const packageDirs = new Set<string>()
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue
        for (const id of file.moduleIds) {
          const dir = packageDirOf(id)
          if (dir) packageDirs.add(dir)
        }
      }

      const byNameVersion = new Map<string, ThirdPartyPackage>()
      for (const pkg of await Promise.all(Array.from(packageDirs, readPackage))) {
        byNameVersion.set(`${pkg.name}@${pkg.version}`, pkg)
      }
      const packages = Array.from(byNameVersion.values()).sort(
        (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
      )

      const disallowed = packages.filter(p => !isAllowed(p.license))
      if (disallowed.length) {
        this.error(
          'Bundled packages have licenses that are not allowed or could not be determined:\n' +
            disallowed.map(p => `  ${p.name}@${p.version}: ${p.license}`).join('\n') +
            '\nIf the license is actually fine, add it to ALLOWED_LICENSES, or to ' +
            'CLARIFIED_LICENSES if the package misdeclares it, in build-plugins/third-party-licenses.ts',
        )
      }

      const withoutFiles = packages.filter(p => !p.licenseFiles.length)
      if (withoutFiles.length) {
        this.warn(
          'Bundled packages ship no license file, so only their declared license is recorded: ' +
            withoutFiles.map(p => `${p.name}@${p.version}`).join(', '),
        )
      }

      output = { build, packages }
    },

    /**
     * Written outside the bundle rather than emitted into it: the web build's output directory is
     * served with immutable caching, and this file keeps one name across builds.
     */
    async writeBundle() {
      if (!output) return
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, JSON.stringify(output), { encoding: 'utf8', flush: true })
    },
  }
}

/** The directory of the installed package a module belongs to, or undefined for our own code. */
export function packageDirOf(id: string): string | undefined {
  if (id.startsWith('\0')) return undefined
  const file = id.replace(/[?#].*$/, '').replaceAll('\\', '/')
  // The last `node_modules` is the one that holds the package: pnpm nests real packages as
  // `node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>`.
  const marker = '/node_modules/'
  const index = file.lastIndexOf(marker)
  if (index === -1) return undefined

  const segments = file.slice(index + marker.length).split('/')
  const nameSegments = segments[0].startsWith('@') ? 2 : 1
  return file.slice(0, index + marker.length) + segments.slice(0, nameSegments).join('/')
}

async function readPackage(dir: string): Promise<ThirdPartyPackage> {
  const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
  const name: string = manifest.name
  const licenseFileNames = await licenseFilesIn(dir)
  const vendorDir = VENDOR_DIRS.get(name)
  if (vendorDir) {
    for (const entry of await readdir(path.join(dir, vendorDir), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const subdir = path.posix.join(vendorDir, entry.name)
      for (const fileName of await licenseFilesIn(path.join(dir, subdir))) {
        licenseFileNames.push(path.posix.join(subdir, fileName))
      }
    }
  }

  return {
    name,
    version: manifest.version,
    license: CLARIFIED_LICENSES.get(name) ?? declaredLicense(manifest),
    repository: repositoryUrl(manifest.repository),
    licenseFiles: await Promise.all(
      licenseFileNames.map(async fileName => ({
        fileName,
        text: await readFile(path.join(dir, fileName), 'utf8'),
      })),
    ),
  }
}

async function licenseFilesIn(dir: string): Promise<string[]> {
  return (await readdir(dir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && LICENSE_FILE.test(entry.name))
    .map(entry => entry.name)
    .sort()
}

/** The manifest's license, including the object forms some older packages still use. */
function declaredLicense(manifest: {
  license?: string | { type?: string }
  licenses?: Array<{ type?: string }>
}): string {
  if (typeof manifest.license === 'string') return manifest.license
  if (manifest.license?.type) return manifest.license.type
  const types = manifest.licenses?.map(l => l.type).filter(t => t !== undefined)
  if (types?.length) return types.length === 1 ? types[0] : `(${types.join(' OR ')})`
  return 'UNKNOWN'
}

/** A browsable URL for the manifest's `repository`, which may be a shorthand like `user/repo`. */
export function repositoryUrl(
  repository: string | { url?: string } | undefined,
): string | undefined {
  const raw = typeof repository === 'string' ? repository : repository?.url
  if (!raw) return undefined

  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(raw)
  if (shorthand) return `https://github.com/${shorthand[1]}`

  return raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/\.git$/, '')
}

/**
 * Whether an SPDX license expression can be satisfied with {@link ALLOWED_LICENSES}. Anything that
 * doesn't parse as an expression (`UNKNOWN`, `SEE LICENSE IN ...`, `Public Domain`) is not.
 */
export function isAllowed(expression: string): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? []
  let pos = 0

  // or := and ('OR' and)* ; and := atom ('AND' atom)* ; atom := '(' or ')' | id ('WITH' id)?
  const parseOr = (): boolean => {
    let result = parseAnd()
    while (tokens[pos] === 'OR') {
      pos++
      // Evaluated first so the remaining tokens are always consumed.
      const rhs = parseAnd()
      result = result || rhs
    }
    return result
  }
  const parseAnd = (): boolean => {
    let result = parseAtom()
    while (tokens[pos] === 'AND') {
      pos++
      const rhs = parseAtom()
      result = result && rhs
    }
    return result
  }
  const parseAtom = (): boolean => {
    const token = tokens[pos++]
    if (token === '(') {
      const result = parseOr()
      if (tokens[pos++] !== ')') throw new Error('unbalanced parentheses')
      return result
    }
    if (token === undefined || token === ')' || token === 'AND' || token === 'OR') {
      throw new Error(`unexpected token ${token}`)
    }
    // An exception (`WITH`) only ever grants more, so it doesn't affect whether the base is fine.
    if (tokens[pos] === 'WITH') pos += 2
    return ALLOWED_LICENSES.has(token.replace(/\+$/, ''))
  }

  try {
    const result = parseOr()
    return pos === tokens.length && result
  } catch {
    return false
  }
}
