import { createContext } from 'react'
import { Lobby } from '../../common/lobbies'

export interface LobbyContextValue {
  /** The lobby that is currently being displayed. */
  lobby: Lobby
}

export const LobbyContext = createContext<LobbyContextValue>({
  lobby: new Lobby(),
})
