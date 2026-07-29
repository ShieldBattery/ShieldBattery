import { List, Map, Record } from 'immutable'
import { GameType } from '../../common/games/game-type'
import { LobbySummaryJson } from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { MapInfoJson } from '../../common/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { LOBBIES_COUNT_UPDATE, LOBBIES_LIST_UPDATE } from '../actions'

export class HostRecord extends Record({
  name: '',
  id: 0 as SbUserId,
}) {}

export class LobbySummary extends Record({
  id: '' as SbLobbyId,
  name: '',
  map: undefined as MapInfoJson | undefined,
  gameType: GameType.Melee,
  gameSubType: 0,
  host: new HostRecord(),
  openSlotCount: -1,
}) {}

export class LobbyList extends Record({
  list: List<SbLobbyId>(),
  byId: Map<SbLobbyId, LobbySummary>(),
  count: 0,
}) {}

function createSummary(lobbyData: LobbySummaryJson): LobbySummary {
  return new LobbySummary({
    ...lobbyData,
    host: new HostRecord(lobbyData.host),
  })
}

function handleFull(state: LobbyList, data: LobbySummaryJson[]): LobbyList {
  const byId = Map(
    data.map(lobby => {
      const summary = createSummary(lobby)
      return [summary.id, summary]
    }),
  )
  const list = byId
    .valueSeq()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(summary => summary.id)
    .toList()
  return new LobbyList({ list, byId, count: state.count })
}

function handleAdd(state: LobbyList, data: LobbySummaryJson): LobbyList {
  if (state.byId.has(data.id)) return state

  const insertBefore = state.list.findEntry(
    id => data.name.localeCompare(state.byId.get(id)!.name) < 1,
  )
  const index = insertBefore ? insertBefore[0] : state.list.size
  const updatedList = state.list.insert(index, data.id)
  return state.setIn(['byId', data.id], createSummary(data)).set('list', updatedList)
}

function handleUpdate(state: LobbyList, data: LobbySummaryJson): LobbyList {
  if (!state.byId.has(data.id)) return state

  const summary = createSummary(data)
  return state.setIn(['byId', summary.id], summary)
}

function handleDelete(state: LobbyList, data: SbLobbyId): LobbyList {
  if (!state.byId.has(data)) return state

  const newState = state.deleteIn(['byId', data])
  const listEntry = state.list.findEntry(id => id === data)
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
