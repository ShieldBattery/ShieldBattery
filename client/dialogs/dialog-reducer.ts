import { Immutable } from 'immer'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
import { DialogType } from './dialog-type'

export interface DialogState {
  type: DialogType
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

    state.history.push({ type, initData })
  },

  ['@dialogs/close'](state, action) {
    state.history.pop()
  },
})
