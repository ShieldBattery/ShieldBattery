import { ThunkAction } from '../dispatch-registry'
import { push } from './routing'

// Pick a location to direct the user to given data from the store, used as an "index" page since we
// don't really have a root content page
export function goToIndex(transitionFn = push): ThunkAction {
  return (_, getState) => {
    const {
      lobby,
      whispers: { sessions },
      chat: { idToInfo, joinedChannels },
    } = getState()
    if (lobby.inLobby && IS_ELECTRON) {
      transitionFn(`/lobbies/${encodeURIComponent(lobby.info.name)}`)
    } else if (joinedChannels.size) {
      const channelId = joinedChannels.values().next().value
      transitionFn(`/chat/${channelId}/${encodeURIComponent(idToInfo.get(channelId)!.name)}`)
    } else if (sessions.size) {
      transitionFn(`/whispers/${encodeURIComponent(sessions.first()!)}`)
    } else {
      transitionFn('/chat')
    }
  }
}
