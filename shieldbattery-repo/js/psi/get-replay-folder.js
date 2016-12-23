import path from 'path'
import { getDocumentsPath } from './natives/index'

export default function getReplayFolder() {
  return path.join(getDocumentsPath(), 'Starcraft', 'maps', 'replays')
}
