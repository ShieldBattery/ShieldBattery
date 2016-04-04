import { routeActions } from 'redux-simple-router'

// Pick a location to direct the user to given data from the store, used as an "index" page since we
// don't really have a root content page
export function goToIndex(transitionFn = routeActions.push) {
  return (dispatch, getState) => {
    const { lobby, whispers, chat: { channels } } = getState()
    if (lobby.inLobby) {
      dispatch(transitionFn(`/lobbies/${encodeURIComponent(lobby.info.name)}`))
    } else if (channels.size) {
      dispatch(transitionFn(`/chat/${encodeURIComponent(channels.first())}`))
    } else if (whispers.size) {
      dispatch(transitionFn(`/whispers/${encodeURIComponent(whispers.get(0).from)}`))
    } else {
      dispatch(transitionFn('/chat/'))
    }
  }
}
