import { List, Map, Record } from 'immutable'
import { MapRecord } from './maps-reducer'
import { LOBBIES_LIST_UPDATE } from '../actions'

export const HostRecord = new Record({
  name: null,
  id: null,
})
export const LobbySummary = new Record({
  name: null,
  map: null,
  gameType: null,
  gameSubType: null,
  host: null,
  openSlotCount: -1,
})
export const LobbyList = new Record({
  list: new List(),
  byName: new Map(),
})

function createSummary(lobbyData) {
  return new LobbySummary({
    ...lobbyData,
    map: new MapRecord(lobbyData.map),
    host: new HostRecord(lobbyData.host),
  })
}

function handleFull(state, data) {
  const byName = new Map(data.map(lobby => {
    const summary = createSummary(lobby)
    return [ summary.name, summary ]
  }))
  const list = byName.keySeq().sort((a, b) => a.localeCompare(b)).toList()
  return new LobbyList({ list, byName })
}

function handleAdd(state, data) {
  if (state.byName.has(data.name)) return state

  const insertBefore = state.list.findEntry(name => data.name.localeCompare(name) < 1)
  const index = insertBefore ? insertBefore[0] : state.list.size
  const updatedList = state.list.insert(index, data.name)
  return state.setIn([ 'byName', data.name ], createSummary(data)).set('list', updatedList)
}

function handleUpdate(state, data) {
  if (!state.byName.has(data.name)) return state

  const summary = createSummary(data)
  return state.setIn([ 'byName', summary.name ], summary)
}

function handleDelete(state, data) {
  if (!state.byName.has(data)) return state

  const newState = state.deleteIn([ 'byName', data ])
  const listEntry = state.list.findEntry(name => name === data)
  return newState.deleteIn([ 'list', listEntry[0] ])
}

export default function lobbyListReducer(state = new LobbyList(), action) {
  if (action.type !== LOBBIES_LIST_UPDATE) return state

  const { message, data } = action.payload
  switch (message) {
    case 'full': return handleFull(state, data)
    case 'add': return handleAdd(state, data)
    case 'update': return handleUpdate(state, data)
    case 'delete': return handleDelete(state, data)
    default: return state
  }
}
