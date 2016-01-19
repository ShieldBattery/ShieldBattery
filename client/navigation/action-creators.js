import { routeActions } from 'redux-simple-router'

// Pick a location to direct the user to given data from the store, used as an "index" page since we
// don't really have a root content page
export function goToIndex(transitionFn = routeActions.push) {
  return (dispatch, getState) => {
    const { lobby, whispers, chatChannels } = getState()
    if (lobby && lobby.name) {
      dispatch(transitionFn(`/lobbies/${encodeURIComponent(lobby.name)}`))
    } else if (chatChannels.size) {
      dispatch(transitionFn(`/chat/${encodeURIComponent(chatChannels.get(0).name)}`))
    } else if (whispers.size) {
      dispatch(transitionFn(`/whispers/${encodeURIComponent(whispers.get(0).from)}`))
    } else {
      dispatch(transitionFn('/chat/'))
    }
  }
}
