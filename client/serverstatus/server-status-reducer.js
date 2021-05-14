import { Record } from 'immutable'
import { LOBBIES_COUNT_UPDATE, NETWORK_SITE_CONNECTED, SERVER_STATUS } from '../actions'
import keyedReducer from '../reducers/keyed-reducer'

const ServerStatus = Record({
  activeUsers: 0,
  lobbyCount: 0,
})

export default keyedReducer(ServerStatus(), {
  [LOBBIES_COUNT_UPDATE]: (state, action) => state.set('lobbyCount', action.payload.count),
  [SERVER_STATUS]: (state, action) => state.set('activeUsers', action.payload.users),
  [NETWORK_SITE_CONNECTED]: () => ServerStatus(),
})
