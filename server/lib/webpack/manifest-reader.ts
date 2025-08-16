import { readFile } from 'node:fs/promises'
import path from 'node:path'
import logger from '../logging/logger'

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
let manifestPath: string | null = null
let assetsCache: { js: string[]; css: string[] } | null = null

function getManifestPath(): string {
  if (!manifestPath) {
    manifestPath = path.join(__dirname, '..', '..', 'public', 'scripts', 'manifest.json')
  }
  return manifestPath
}

/**
 * Read the webpack manifest file to get the actual filenames with content hashes.
 * In development, returns predictable filenames. In production, reads from manifest.json.
 */
export async function getWebpackAssets(): Promise<{ js: string[]; css: string[] }> {
  const isDev = process.env.NODE_ENV !== 'production'

  if (isDev) {
    // In development, use predictable filenames
    return {
      js: ['/scripts/client.js'],
      css: [],
    }
  }

  if (assetsCache) {
    return assetsCache
  }

  if (!manifestCache) {
    try {
      const manifestContent = await readFile(getManifestPath(), 'utf8')
      manifestCache = JSON.parse(manifestContent)
    } catch (err) {
      logger.warn({ err }, 'Could not read webpack manifest, falling back to default assets')
      return {
        js: ['/scripts/client.js'],
        css: [],
      }
    }
  }

  if (!manifestCache) {
    return {
      js: ['/scripts/client.js'],
      css: [],
    }
  }

  let jsFiles: string[] = []
  let cssFiles: string[] = []

  if (manifestCache.entrypoints?.client?.assets) {
    jsFiles = manifestCache.entrypoints.client.assets.js || []
    cssFiles = manifestCache.entrypoints.client.assets.css || []
  } else {
    if (typeof manifestCache['client.js'] === 'string') {
      jsFiles = [manifestCache['client.js']]
    }
  }

  assetsCache = {
    js: jsFiles,
    css: cssFiles,
  }

  return assetsCache
}
