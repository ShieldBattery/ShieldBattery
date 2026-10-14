import { atom } from 'jotai'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'

export interface ReplayDownloadProgress {
  lobbyId: SbLobbyId
  loadedBytes: number
  totalBytes: number
}

export const replayDownloadProgressAtom = atom<ReplayDownloadProgress | undefined>(undefined)
