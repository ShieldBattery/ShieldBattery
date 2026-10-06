// usage: node cmds.mjs <replay> <from> <to> — prints the replay's commands in a frame range.
import * as fs from 'node:fs'
import { init, parseReplay } from '@shieldbattery/broodrep'
init()
const rep = parseReplay(new Uint8Array(fs.readFileSync(process.argv[2])))
const [from, to] = [Number(process.argv[3]), Number(process.argv[4])]
for (const c of rep.getCommands()) {
  const f = c.frame ?? c.frameNumber
  if (f >= from && f <= to) console.log(JSON.stringify(c).slice(0, 220))
}
