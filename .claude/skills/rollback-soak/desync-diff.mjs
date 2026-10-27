// Finds where a live game's simulation left plain playback of its replay.
//
//   node desync-diff.mjs <live game log> <plain run>  [--game <game id>]
//     <plain run> is a plain playback's probe CSV (SB_ROLLBACK_PROBE=1, every frame) or its game
//     log (Sync probe lines, every 240 frames). The live side is the game log's desync evidence
//     block (the last 64 confirmed report positions) plus its confirmed Sync probe lines. Prints
//     the last report position that agrees, and the first that differs with the hash components
//     that differ.
//
//   node desync-diff.mjs --units <unit table> <unit table>
//     Compares two desync-units-*.csv tables (an eviction's and a plain playback's from
//     SB_DESYNC_UNITS_FRAME=<frame>) unit by unit.
//
// A game log keeps several launches; the last one is read unless --game picks the launch whose
// [SESSION_START] line names that game id.

import fs from 'node:fs'
import path from 'node:path'

const COMPONENTS = ['frame_rng', 'economy', 'supply', 'tech', 'units', 'bullets']

const HEX = '([0-9a-f]{16})'
const EVIDENCE_LINE = new RegExp(
  `^\\s+(\\d+) (\\d+) ${HEX} ${HEX} ${HEX} ${HEX} ${HEX} (\\d+)/${HEX} (\\d+)/${HEX}\\s*$`,
)
const PROBE_LINE = new RegExp(
  `Sync probe: frame (\\d+) .*?hash ${HEX} frame_rng ${HEX} economy ${HEX} supply ${HEX} ` +
    `tech ${HEX} units (\\d+)/${HEX} bullets (\\d+)/${HEX}(?: position (\\d+))?`,
)

function usage() {
  console.error(
    'usage: node desync-diff.mjs <live game log> <plain probe CSV or game log> [--game <id>]\n' +
      '       node desync-diff.mjs --units <unit table> <unit table>',
  )
  process.exit(2)
}

// The lines of the launch to read: the last one, or the one whose session line names `gameId`.
function sessionLines(file, gameId) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const starts = []
  lines.forEach((line, i) => {
    if (line.includes('[SESSION_START]')) starts.push(i)
  })
  if (starts.length === 0) return lines
  let start = starts[starts.length - 1]
  if (gameId) {
    const found = starts.filter(i => lines[i].includes(`game_id=${gameId} `))
    if (found.length === 0) throw new Error(`${file}: no launch of game ${gameId}`)
    start = found[found.length - 1]
  }
  const next = starts.find(i => i > start) ?? lines.length
  return lines.slice(start, next)
}

function entry(frame, position, hash, values, unitCount, bulletCount) {
  const components = Object.fromEntries(COMPONENTS.map((name, i) => [name, values[i]]))
  components.units = `${unitCount}/${components.units}`
  components.bullets = `${bulletCount}/${components.bullets}`
  return { frame, position, hash, components }
}

// Hash readings by frame from a game log: evidence block lines and Sync probe lines.
function readLog(file, gameId) {
  const byFrame = new Map()
  let inBlock = false
  for (const line of sessionLines(file, gameId)) {
    if (line.includes('Desync evidence, the last')) {
      inBlock = true
      continue
    }
    if (inBlock) {
      const m = EVIDENCE_LINE.exec(line)
      if (m) {
        const [, position, frame, hash, a, b, c, d, units, unitsHash, bullets, bulletsHash] = m
        byFrame.set(
          Number(frame),
          entry(
            Number(frame),
            Number(position),
            hash,
            [a, b, c, d, unitsHash, bulletsHash],
            units,
            bullets,
          ),
        )
        continue
      }
      inBlock = false
    }
    const m = PROBE_LINE.exec(line)
    if (m) {
      const [, frame, hash, a, b, c, d, units, unitsHash, bullets, bulletsHash, position] = m
      byFrame.set(
        Number(frame),
        entry(
          Number(frame),
          position === undefined ? undefined : Number(position),
          hash,
          [a, b, c, d, unitsHash, bulletsHash],
          units,
          bullets,
        ),
      )
    }
  }
  return byFrame
}

// Hash readings by frame from a probe CSV, or a harness CSV's confirmed (c_) columns.
function readCsv(file) {
  const lines = fs.readFileSync(file, 'latin1').split(/\r?\n/)
  const header = lines[0].split(',')
  const prefix = header.includes('c_state_hash') ? 'c_' : ''
  const frameColumn = prefix ? 'confirmed_frame' : 'frame'
  const col = name => header.indexOf(name)
  if (col(`${prefix}units_hash`) < 0) {
    throw new Error(`${file} has no hash component columns; it predates them`)
  }
  const byFrame = new Map()
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    // The probe interleaves allocation dumps into its file; only fingerprint rows parse.
    if (cols.length < header.length - 1 || !/^\d+$/.test(cols[0])) continue
    const get = name => cols[col(prefix + name)]
    const frame = Number(cols[col(frameColumn)])
    byFrame.set(
      frame,
      entry(
        frame,
        undefined,
        get('state_hash'),
        COMPONENTS.map(name => get(`${name}_hash`)),
        get('unit_count'),
        get('bullet_count'),
      ),
    )
  }
  return byFrame
}

function readPlain(file) {
  return path.extname(file).toLowerCase() === '.csv' ? readCsv(file) : readLog(file)
}

function describe(e) {
  return e.position === undefined ? `frame ${e.frame}` : `position ${e.position} (frame ${e.frame})`
}

function compareHashes(liveFile, plainFile, gameId) {
  const live = readLog(liveFile, gameId)
  const plain = readPlain(plainFile)
  if (live.size === 0) {
    console.log(`${liveFile}: no evidence block or Sync probe lines with hash components`)
    process.exit(1)
  }
  const frames = [...live.keys()].filter(frame => plain.has(frame)).sort((a, b) => a - b)
  const liveFrames = [...live.keys()].sort((a, b) => a - b)
  console.log(
    `live: ${live.size} readings, frames ${liveFrames[0]}..${liveFrames.at(-1)}; ` +
      `plain: ${plain.size} readings; ${frames.length} frames in both`,
  )
  if (frames.length === 0) {
    console.log('No frame was read on both sides')
    process.exit(1)
  }
  let lastAgreeing = null
  for (const frame of frames) {
    const a = live.get(frame)
    const b = plain.get(frame)
    const differing = COMPONENTS.filter(name => a.components[name] !== b.components[name])
    if (differing.length === 0 && a.hash === b.hash) {
      lastAgreeing = a
      continue
    }
    console.log(`last agreeing: ${lastAgreeing ? describe(lastAgreeing) : 'none'}`)
    console.log(`first differing: ${describe(a)}`)
    for (const name of differing) {
      console.log(`  ${name.padEnd(9)} live ${a.components[name]}  plain ${b.components[name]}`)
    }
    if (differing.length === 0) console.log(`  combined hash only: live ${a.hash}  plain ${b.hash}`)
    process.exit(1)
  }
  console.log(`All ${frames.length} frames agree, through ${describe(lastAgreeing)}`)
}

function readUnitTable(file) {
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(line => line && !line.startsWith('#'))
  const header = lines[0].split(',')
  const units = new Map()
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    units.set(cols[0], Object.fromEntries(header.map((name, i) => [name, cols[i]])))
  }
  return { header, units }
}

function compareUnitTables(fileA, fileB) {
  const a = readUnitTable(fileA)
  const b = readUnitTable(fileB)
  let differing = 0
  for (const [index, unitA] of a.units) {
    const unitB = b.units.get(index)
    if (!unitB) {
      console.log(`unit ${index} (type ${unitA.unit_id}, player ${unitA.player}) only in ${fileA}`)
      differing++
      continue
    }
    if (unitA.unit_hash === unitB.unit_hash) continue
    differing++
    const fields = a.header
      .filter(name => name !== 'unit_hash' && unitA[name] !== unitB[name])
      .map(name => `${name} ${unitA[name]} vs ${unitB[name]}`)
    console.log(
      `unit ${index} (type ${unitA.unit_id}, player ${unitA.player}): ` +
        (fields.length ? fields.join(', ') : 'fields outside the table differ'),
    )
  }
  for (const [index, unitB] of b.units) {
    if (!a.units.has(index)) {
      console.log(`unit ${index} (type ${unitB.unit_id}, player ${unitB.player}) only in ${fileB}`)
      differing++
    }
  }
  console.log(`${differing} of ${a.units.size}/${b.units.size} units differ`)
  process.exit(differing ? 1 : 0)
}

const args = process.argv.slice(2)
if (args[0] === '--units') {
  if (args.length !== 3) usage()
  compareUnitTables(args[1], args[2])
} else {
  const gameIndex = args.indexOf('--game')
  const gameId = gameIndex >= 0 ? args[gameIndex + 1] : undefined
  const files = args.filter((_, i) => gameIndex < 0 || (i !== gameIndex && i !== gameIndex + 1))
  if (files.length !== 2) usage()
  compareHashes(files[0], files[1], gameId)
}
