import { atom } from 'jotai'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'

export interface ReplayDownloadProgress {
  lobbyId: SbLobbyId
  hash: string
  state: 'downloading' | 'ready' | 'error'
  loadedBytes: number
  totalBytes: number
}

export const replayDownloadProgressAtom = atom<ReplayDownloadProgress | undefined>(undefined)
