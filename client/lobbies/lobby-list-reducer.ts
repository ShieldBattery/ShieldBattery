import { LobbySummaryJson } from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { LOBBIES_COUNT_UPDATE, LOBBIES_LIST_UPDATE } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface LobbyListState {
  /** Lobby ids, kept sorted by lobby name. */
  list: SbLobbyId[]
  byId: Map<SbLobbyId, LobbySummaryJson>
  count: number
}

const DEFAULT_STATE: LobbyListState = {
  list: [],
  byId: new Map(),
  count: 0,
}

/** Inserts `id` into `list` (kept sorted by lobby name) at the position that keeps it sorted. */
function insertSorted(
  list: SbLobbyId[],
  summary: LobbySummaryJson,
  byId: ReadonlyMap<SbLobbyId, LobbySummaryJson>,
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
      draft.byId = new Map(data.map(summary => [summary.id, summary]))
      draft.list = data
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(summary => summary.id)
      return
    }

    if (message === 'add') {
      if (draft.byId.has(data.id)) return
      draft.byId.set(data.id, data)
      insertSorted(draft.list, data, draft.byId)
      return
    }

    if (message === 'update') {
      if (!draft.byId.has(data.id)) return
      draft.byId.set(data.id, data)
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
