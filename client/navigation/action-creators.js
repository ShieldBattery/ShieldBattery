import { routerActions } from 'react-router-redux'

// Pick a location to direct the user to given data from the store, used as an "index" page since we
// don't really have a root content page
export function goToIndex(transitionFn = routerActions.push) {
  return (dispatch, getState) => {
    const { lobby, whispers: { sessions }, chat: { channels } } = getState()
    if (lobby.inLobby && process.webpackEnv.SB_ENV === 'electron') {
      dispatch(transitionFn(`/lobbies/${encodeURIComponent(lobby.info.name)}`))
    } else if (channels.size) {
      dispatch(transitionFn(`/chat/${encodeURIComponent(channels.first())}`))
    } else if (sessions.size) {
      dispatch(transitionFn(`/whispers/${encodeURIComponent(sessions.get(0).from)}`))
    } else {
      dispatch(transitionFn('/chat/'))
    }
  }
}
