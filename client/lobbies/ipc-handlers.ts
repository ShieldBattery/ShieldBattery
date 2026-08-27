import { TypedIpcRenderer } from '../../common/ipc'
import { navigateToLobby } from './lobby-url'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  ipcRenderer.on('lobbyDeepLink', (event, lobbyId) => {
    navigateToLobby(lobbyId)
  })
}
