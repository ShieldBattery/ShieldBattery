import { TypedIpcRenderer } from '../../common/ipc'
import { push } from '../navigation/routing'
import { getGameReplayTimestampUrl, navigateToGameResults } from './action-creators'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  ipcRenderer.on('gameDeepLink', (event, { gameId, timestampSeconds }) => {
    if (timestampSeconds !== undefined) {
      push(getGameReplayTimestampUrl(gameId, timestampSeconds))
    } else {
      navigateToGameResults(gameId)
    }
  })
}
