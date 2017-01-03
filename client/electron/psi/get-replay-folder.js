import path from 'path'
import { remote } from 'electron'

export default function getReplayFolder() {
  return path.join(remote.app.getPath('documents'), 'Starcraft', 'maps', 'replays')
}
