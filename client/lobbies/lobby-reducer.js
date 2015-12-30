import { Record } from 'immutable'

export const Lobby = new Record({
  name: '5v3 BGH Comp Stomp',
})

export default function lobbyReducer(state = new Lobby(), action) {
  return state
}
