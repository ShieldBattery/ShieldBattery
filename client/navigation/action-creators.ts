import { ThunkAction } from '../dispatch-registry'
import { push } from './routing'

// Pick a location to direct the user to given data from the store, used as an "index" page since we
// don't really have a root content page
export function goToIndex(transitionFn = push): ThunkAction {
  return (_, getState) => {
    const {
      lobby,
      whispers: { sessions },
      chat: { channels },
    } = getState()
    if (lobby.inLobby && IS_ELECTRON) {
      transitionFn(`/lobbies/${encodeURIComponent(lobby.info.name)}`)
    } else if (channels.size) {
      transitionFn(`/chat/${encodeURIComponent(channels.values().next().value)}`)
    } else if (sessions.size) {
      transitionFn(`/whispers/${encodeURIComponent(sessions.first()!)}`)
    } else {
      transitionFn('/chat')
    }
  }
}
