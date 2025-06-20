import { List, Map, Record } from 'immutable'
import { GameType } from '../../common/games/game-type'
import { LobbySummaryJson } from '../../common/lobbies/lobby-network'
import { MapInfoJson } from '../../common/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { LOBBIES_COUNT_UPDATE, LOBBIES_LIST_UPDATE } from '../actions'

export class HostRecord extends Record({
  name: '',
  id: 0 as SbUserId,
}) {}

export class LobbySummary extends Record({
  name: '',
  map: undefined as MapInfoJson | undefined,
  gameType: GameType.Melee,
  gameSubType: 0,
  host: new HostRecord(),
  openSlotCount: -1,
}) {}

export class LobbyList extends Record({
  list: List<string>(),
  byName: Map<string, LobbySummary>(),
  count: 0,
}) {}

function createSummary(lobbyData: LobbySummaryJson): LobbySummary {
  return new LobbySummary({
    ...lobbyData,
    host: new HostRecord(lobbyData.host),
  })
}

function handleFull(state: LobbyList, data: LobbySummaryJson[]): LobbyList {
  const byName = Map(
    data.map(lobby => {
      const summary = createSummary(lobby)
      return [summary.name, summary]
    }),
  )
  const list = byName
    .keySeq()
    .sort((a, b) => a.localeCompare(b))
    .toList()
  return new LobbyList({ list, byName, count: state.count })
}

function handleAdd(state: LobbyList, data: LobbySummaryJson): LobbyList {
  if (state.byName.has(data.name)) return state

  const insertBefore = state.list.findEntry(name => data.name.localeCompare(name) < 1)
  const index = insertBefore ? insertBefore[0] : state.list.size
  const updatedList = state.list.insert(index, data.name)
  return state.setIn(['byName', data.name], createSummary(data)).set('list', updatedList)
}

function handleUpdate(state: LobbyList, data: LobbySummaryJson): LobbyList {
  if (!state.byName.has(data.name)) return state

  const summary = createSummary(data)
  return state.setIn(['byName', summary.name], summary)
}

function handleDelete(state: LobbyList, data: string): LobbyList {
  if (!state.byName.has(data)) return state

  const newState = state.deleteIn(['byName', data])
  const listEntry = state.list.findEntry(name => name === data)
  return listEntry ? newState.deleteIn(['list', listEntry[0]]) : newState
}

export default function lobbyListReducer(state = new LobbyList(), action: any): LobbyList {
  if (action.type === LOBBIES_COUNT_UPDATE) {
    return state.set('count', action.payload.count)
  } else if (action.type === '@network/connect') {
    return new LobbyList()
  }

  if (action.type !== LOBBIES_LIST_UPDATE) return state

  const { message, data } = action.payload
  switch (message) {
    case 'full':
      return handleFull(state, data)
    case 'add':
      return handleAdd(state, data)
    case 'update':
      return handleUpdate(state, data)
    case 'delete':
      return handleDelete(state, data)
    default:
      return state
  }
}
