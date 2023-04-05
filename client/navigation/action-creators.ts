import { urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { push } from './routing'

// Pick a location to direct the user to given data from the store, used as an "index" page since we
// don't really have a root content page
export function goToIndex(transitionFn = push): ThunkAction {
  return (_, getState) => {
    const {
      lobby,
      chat: { idToBasicInfo, joinedChannels },
      users: { byId },
      whispers: { sessions },
    } = getState()
    if (lobby.inLobby && IS_ELECTRON) {
      transitionFn(urlPath`/lobbies/${lobby.info.name}`)
    } else if (joinedChannels.size) {
      const [first] = joinedChannels.values()
      transitionFn(urlPath`/chat/${first}/${idToBasicInfo.get(first)?.name ?? '_'}`)
    } else if (sessions.size) {
      const [first] = sessions
      transitionFn(urlPath`/whispers/${first}/${byId.get(first)?.name ?? '_'}`)
    } else {
      transitionFn('/chat')
    }
  }
}
