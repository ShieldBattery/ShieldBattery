import { GameType } from '../../common/games/game-type'
import { LobbySummaryJson } from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { MapInfoJson } from '../../common/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { LOBBIES_COUNT_UPDATE, LOBBIES_LIST_UPDATE } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

/**
 * A lobby's entry in the public lobby list. Wire-identical to `LobbySummaryJson`, except the host
 * additionally carries a (currently always blank) `name`: the wire summary only ever carries the
 * host's id, not their display name.
 */
export interface LobbySummary {
  id: SbLobbyId
  name: string
  map: MapInfoJson | undefined
  gameType: GameType
  gameSubType: number
  host: { id: SbUserId; name: string }
  openSlotCount: number
}

export interface LobbyListState {
  /** Lobby ids, kept sorted by lobby name. */
  list: SbLobbyId[]
  byId: Map<SbLobbyId, LobbySummary>
  count: number
}

const DEFAULT_STATE: LobbyListState = {
  list: [],
  byId: new Map(),
  count: 0,
}

function createSummary(lobbyData: LobbySummaryJson): LobbySummary {
  return { ...lobbyData, host: { id: lobbyData.host.id, name: '' } }
}

/** Inserts `id` into `list` (kept sorted by lobby name) at the position that keeps it sorted. */
function insertSorted(
  list: SbLobbyId[],
  summary: LobbySummary,
  byId: ReadonlyMap<SbLobbyId, LobbySummary>,
): void {
  const index = list.findIndex(otherId => summary.name.localeCompare(byId.get(otherId)!.name) < 1)
  list.splice(index === -1 ? list.length : index, 0, summary.id)
}

export default immerKeyedReducer(DEFAULT_STATE, {
  [LOBBIES_COUNT_UPDATE as any](draft: LobbyListState, action: { payload: { count: number } }) {
    draft.count = action.payload.count
  },

  ['@network/connect' as any]() {
    return DEFAULT_STATE
  },

  [LOBBIES_LIST_UPDATE as any](
    draft: LobbyListState,
    action: {
      payload:
        | { message: 'full'; data: LobbySummaryJson[] }
        | { message: 'add' | 'update'; data: LobbySummaryJson }
        | { message: 'delete'; data: SbLobbyId }
    },
  ) {
    const { message, data } = action.payload

    if (message === 'full') {
      const summaries = data.map(createSummary)
      draft.byId = new Map(summaries.map(summary => [summary.id, summary]))
      draft.list = summaries
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(summary => summary.id)
      return
    }

    if (message === 'add') {
      if (draft.byId.has(data.id)) return
      const summary = createSummary(data)
      draft.byId.set(summary.id, summary)
      insertSorted(draft.list, summary, draft.byId)
      return
    }

    if (message === 'update') {
      if (!draft.byId.has(data.id)) return
      draft.byId.set(data.id, createSummary(data))
      return
    }

    if (message === 'delete') {
      if (!draft.byId.has(data)) return
      draft.byId.delete(data)
      const index = draft.list.indexOf(data)
      if (index !== -1) draft.list.splice(index, 1)
    }
  },
})
