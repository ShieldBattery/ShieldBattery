import { Immutable } from 'immer'
import { findLastIndex } from '../../common/data-structures/arrays'
import { NETWORK_SITE_DISCONNECTED } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
import { DialogType } from './dialog-type'

export interface DialogState {
  type: DialogType
  id: string
  initData?: Record<string, unknown>
}

export interface DialogHistoryState {
  history: DialogState[]
}

const DEFAULT_DIALOG_HISTORY_STATE: Immutable<DialogHistoryState> = {
  history: [],
}

export default immerKeyedReducer(DEFAULT_DIALOG_HISTORY_STATE, {
  ['@dialogs/open'](state, action) {
    const { type, initData } = action.payload

    // Close any dialogs of the same type (open effectively brings this dialog type to the front)
    // TODO(tec27): This doesn't feel totally safe to do, especially given that we have fairly
    // generic types (simple, etc.). It will likely work for now (and fixes other bugs), but we
    // should probably reconsider how all of this works together
    const dialogIndex = findLastIndex(state.history, h => h.type === type)
    if (dialogIndex >= 0) {
      state.history = state.history.slice(0, dialogIndex)
    }

    state.history.push({ type, initData, id: action.meta.id })
  },

  ['@dialogs/close'](state, action) {
    const { dialogType } = action.payload

    if (dialogType === 'all') {
      state.history = []
      return
    }

    const dialogIndex = findLastIndex(state.history, h => h.type === dialogType)
    if (dialogIndex < 0) {
      return
    }

    state.history = state.history.slice(0, dialogIndex)
  },

  [NETWORK_SITE_DISCONNECTED as any]() {
    return DEFAULT_DIALOG_HISTORY_STATE
  },
})
