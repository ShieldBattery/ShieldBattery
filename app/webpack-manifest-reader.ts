import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getErrorStack } from '../common/errors'
import logger from './logger'

interface WebpackEntrypoint {
  [entryName: string]: {
    assets: {
      js?: string[]
      css?: string[]
    }
  }
}

interface WebpackAssetsManifest {
  entrypoints?: WebpackEntrypoint
  [key: string]: string | WebpackEntrypoint | undefined
}

let manifestCache: WebpackAssetsManifest | null = null
let assetsCache: string[] | null = null

function getManifestPath(): string {
  return path.join(__dirname, 'dist', 'manifest.json')
}

/**
 * Read the webpack manifest file to get the actual filenames with content hashes for Electron.
 * In development, returns predictable filenames. In production, reads from manifest.json.
 */
export async function getElectronWebpackAssets(): Promise<string[]> {
  const isDev = process.env.NODE_ENV !== 'production'

  if (isDev) {
    // In development, use predictable filename
    return ['/dist/bundle.js']
  }

  if (assetsCache) {
    return assetsCache
  }

  if (!manifestCache) {
    try {
      const manifestContent = await readFile(getManifestPath(), 'utf8')
      manifestCache = JSON.parse(manifestContent)
    } catch (err) {
      logger.warn(
        `Could not read webpack manifest, falling back to default assets: ${getErrorStack(err)}`,
      )
      return ['/dist/bundle.js']
    }
  }

  if (!manifestCache) {
    return ['/dist/bundle.js']
  }

  let jsFiles: string[] = []

  if (manifestCache.entrypoints?.bundle?.assets?.js) {
    jsFiles = manifestCache.entrypoints.bundle.assets.js
  } else {
    if (typeof manifestCache['bundle.js'] === 'string') {
      jsFiles = [manifestCache['bundle.js']]
    }
  }

  assetsCache = jsFiles.length > 0 ? jsFiles : ['/dist/bundle.js']

  return assetsCache
}
