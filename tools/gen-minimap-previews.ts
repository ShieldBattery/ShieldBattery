/**
 * Generates the minimap preview images shown in the team-color settings panels
 * (`client/settings/game/team-color-preview.tsx`) -- one PNG per preview tileset, rendered from a
 * real map file through the same bw-chk + BW sprite data pipeline the map upload system uses
 * (`server/lib/maps/parse-map.js`, `server/lib/maps/map-parse-worker.js`).
 *
 * Usage (run from repo root):
 *   pnpm run gen-minimap-previews -- <maps-folder> [--bw-data <path>] [--out <dir>]
 *   node -r ./babel-register tools/gen-minimap-previews.ts <maps-folder> [--bw-data <path>] [--out <dir>]
 *
 * <maps-folder>  A directory containing map files (.scm/.scx), one per tileset, any filenames --
 *                the tileset is read from each map's CHK data, not inferred from the file name.
 *                Extra/duplicate tilesets or a missing/empty folder are fine: anything not
 *                covered gets a flat placeholder instead (see below).
 * --bw-data      BW data directory (the unit/ + tileset/ folders extracted from stardat.mpq +
 *                broodat.mpq -- see docs/GETTING_STARTED.md, "Set up map system"). Defaults to
 *                SB_SPRITE_DATA from .env, the same variable the map upload pipeline reads
 *                (server/lib/maps/store.ts).
 * --out          Output directory for the generated PNGs. Defaults to
 *                server/public/images/minimaps -- a static asset directory served by the Node
 *                server and loaded by the client via makePublicAssetUrl, the same pattern used for
 *                e.g. server/public/images/ranks.
 *
 * Any of the 7 preview tilesets (common/maps.ts ALL_TILESET_IDS) that ends up without a real
 * render -- no source map found for it, or that map failed to parse/render -- gets a flat
 * placeholder in that tileset's fallback color (common/maps.ts TILESET_PLACEHOLDER_COLORS)
 * instead, so the settings preview never shows a broken image. Re-run once real maps/BW data are
 * available to replace any placeholders.
 *
 * Idempotent: re-running only rewrites the tilesets whose source map is present this run;
 * everything else is left as either its last real render or a placeholder.
 */

import Chk from 'bw-chk'
import dotenv from 'dotenv'
import dotenvExpand from 'dotenv-expand'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import {
  ALL_MAP_EXTENSIONS,
  ALL_TILESET_IDS,
  MapExtension,
  Tileset,
  TILESET_IDS,
  TILESET_PLACEHOLDER_COLORS,
  TilesetId,
} from '../common/maps'
import { parseAndHashMap } from '../server/lib/maps/parse-map'

dotenvExpand.expand(dotenv.config({ quiet: true }))

const REPO_ROOT = path.resolve(__dirname, '..')
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'server', 'public', 'images', 'minimaps')
/** Matches the preview panel's fixed CSS width (`Preview` in team-color-settings.tsx). */
const PREVIEW_WIDTH = 576

interface ParsedArgs {
  mapsFolder: string
  bwDataPath: string
  outDir: string
}

function printUsageAndExit(message?: string): never {
  if (message) {
    console.error(message + '\n')
  }
  console.error(
    'usage: gen-minimap-previews <maps-folder> [--bw-data <path>] [--out <dir>]\n\n' +
      '  <maps-folder>  Directory of .scm/.scx maps, one per tileset (tileset is read from each\n' +
      "                 map's CHK data; extra/missing tilesets are fine, see file header)\n" +
      '  --bw-data      BW data dir (unit/ + tileset/); defaults to SB_SPRITE_DATA from .env\n' +
      '  --out          Output dir; defaults to server/public/images/minimaps',
  )
  process.exit(1)
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  let bwDataPath = process.env.SB_SPRITE_DATA ?? ''
  let outDir = DEFAULT_OUT_DIR

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--bw-data') {
      bwDataPath = argv[++i]
      if (!bwDataPath) printUsageAndExit('--bw-data requires a path')
    } else if (arg === '--out') {
      outDir = argv[++i]
      if (!outDir) printUsageAndExit('--out requires a path')
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit()
    } else if (arg.startsWith('--')) {
      printUsageAndExit(`Unknown flag: ${arg}`)
    } else {
      positional.push(arg)
    }
  }

  if (positional.length !== 1) {
    printUsageAndExit('Expected exactly one <maps-folder> argument')
  }

  return {
    mapsFolder: path.resolve(positional[0]),
    bwDataPath: bwDataPath ? path.resolve(bwDataPath) : '',
    outDir: path.resolve(outDir),
  }
}

type RenderResult =
  | { tilesetId: TilesetId; png: Buffer; width: number; height: number }
  | { skipReason: string }

async function renderMapPreview(filePath: string, bwDataPath: string): Promise<RenderResult> {
  const ext = path.extname(filePath).slice(1).toLowerCase() as MapExtension
  const { map }: { map: InstanceType<typeof Chk> } = await parseAndHashMap(filePath, ext)

  const tilesetId = TILESET_IDS[map.tileset as Tileset]
  if (!tilesetId) {
    return { skipReason: `tileset "${map.tilesetName}" has no preview art (not one of the 7)` }
  }

  const width = PREVIEW_WIDTH
  const height = Math.round((width * map.size[1]) / map.size[0])
  const imageRgb = await map.image(Chk.fsFileAccess(bwDataPath), width, height, { melee: true })
  const png = await sharp(imageRgb, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()

  return { tilesetId, png, width, height }
}

async function writePlaceholder(outDir: string, tilesetId: TilesetId): Promise<void> {
  const size = PREVIEW_WIDTH
  const png = await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: TILESET_PLACEHOLDER_COLORS[tilesetId],
    },
  })
    .png()
    .toBuffer()
  fs.writeFileSync(path.join(outDir, `${tilesetId}.png`), png)
}

function findMapFiles(mapsFolder: string): string[] {
  if (!fs.existsSync(mapsFolder)) {
    console.warn(
      `Maps folder not found: ${mapsFolder} -- every tileset will get a flat placeholder.`,
    )
    return []
  }
  return fs
    .readdirSync(mapsFolder)
    .filter(f => {
      const ext = path.extname(f).slice(1).toLowerCase()
      return (ALL_MAP_EXTENSIONS as ReadonlyArray<string>).includes(ext)
    })
    .map(f => path.join(mapsFolder, f))
}

async function main(): Promise<void> {
  const { mapsFolder, bwDataPath, outDir } = parseArgs(process.argv.slice(2))
  fs.mkdirSync(outDir, { recursive: true })

  const bwDataUsable = Boolean(bwDataPath) && fs.existsSync(bwDataPath)
  if (!bwDataPath) {
    console.warn(
      'No BW data directory configured (pass --bw-data or set SB_SPRITE_DATA in .env) -- every ' +
        'tileset will get a flat placeholder. See docs/GETTING_STARTED.md, "Set up map system".',
    )
  } else if (!bwDataUsable) {
    console.warn(
      `BW data directory not found: ${bwDataPath} -- every tileset will get a flat placeholder.`,
    )
  }

  const mapFiles = findMapFiles(mapsFolder)
  const rendered = new Map<TilesetId, string>()

  if (bwDataUsable) {
    for (const filePath of mapFiles) {
      const name = path.basename(filePath)
      try {
        const result = await renderMapPreview(filePath, bwDataPath)
        if ('skipReason' in result) {
          console.warn(`- skipping ${name}: ${result.skipReason}`)
          continue
        }

        const { tilesetId, png, width, height } = result
        if (rendered.has(tilesetId)) {
          console.warn(
            `- ${name}: another map already provided "${tilesetId}" ` +
              `(${rendered.get(tilesetId)}) -- overwriting with this one`,
          )
        }
        fs.writeFileSync(path.join(outDir, `${tilesetId}.png`), png)
        rendered.set(tilesetId, name)
        console.log(`+ ${tilesetId}.png  <-  ${name}  (${width}x${height})`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`! failed to render ${name}: ${message}`)
      }
    }
  } else if (mapFiles.length > 0) {
    console.warn(
      `Found ${mapFiles.length} map file(s) in ${mapsFolder}, but can't render without BW data.`,
    )
  }

  let placeholderCount = 0
  for (const tilesetId of ALL_TILESET_IDS) {
    if (!rendered.has(tilesetId)) {
      await writePlaceholder(outDir, tilesetId)
      placeholderCount++
      console.log(`~ ${tilesetId}.png  <-  flat placeholder (no map rendered for this tileset)`)
    }
  }

  console.log(
    `\nDone: ${rendered.size} rendered from real maps, ${placeholderCount} placeholder(s), ` +
      `written to ${path.relative(REPO_ROOT, outDir)}`,
  )
}

// Only run the CLI when invoked directly (e.g. via `pnpm run gen-minimap-previews`), not when
// imported elsewhere.
if (typeof require !== 'undefined' && require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
