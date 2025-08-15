import { Immutable } from 'immer'
import { findLastIndex } from '../../common/data-structures/arrays'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
import { DialogPayload, DialogType } from './dialog-type'

export interface DialogState<T extends DialogType = DialogType> {
  type: T
  id: string
  initData?: (DialogPayload & { type: T })['initData']
  /**
   * If true, this dialog will always stay on top of any dialogs that don't have this set. Use
   * sparingly :)
   */
  keepOnTop?: boolean
}

export interface DialogHistoryState {
  history: Array<DialogState>
}

const DEFAULT_DIALOG_HISTORY_STATE: Immutable<DialogHistoryState> = {
  history: [],
}

export default immerKeyedReducer(DEFAULT_DIALOG_HISTORY_STATE, {
  ['@dialogs/open'](state, action) {
    const { type, initData, keepOnTop } = action.payload

    // Close any dialogs of the same type (open effectively brings this dialog type to the front)
    // TODO(tec27): This doesn't feel totally safe to do, especially given that we have fairly
    // generic types (simple, etc.). It will likely work for now (and fixes other bugs), but we
    // should probably reconsider how all of this works together
    const dialogIndex = findLastIndex(state.history, h => h.type === type)
    if (dialogIndex >= 0) {
      // TODO(tec27): Track other dialogs opened by this dialog so we can close those too
      state.history.splice(dialogIndex, 1)
    }

    const dialog: DialogState = { type, initData, id: action.meta.id, keepOnTop }
    if (
      !keepOnTop &&
      state.history.length > 0 &&
      state.history[state.history.length - 1].keepOnTop
    ) {
      // Find the last dialog that doesn't have keepOnTop set and insert it just after that
      const lastNonTopDialogIndex = findLastIndex(state.history, h => !h.keepOnTop)
      state.history.splice(lastNonTopDialogIndex + 1, 0, dialog)
    } else {
      // Otherwise we just push it at the end
      state.history.push(dialog)
    }
  },

  ['@dialogs/close'](state, action) {
    if ('dialogType' in action.payload) {
      const { dialogType } = action.payload

      if (dialogType === 'all') {
        state.history = []
        return
      }

      const dialogIndex = findLastIndex(state.history, h => h.type === dialogType)
      if (dialogIndex < 0) {
        return
      }

      // TODO(tec27): Track other dialogs opened by this dialog so we can close those too
      state.history.splice(dialogIndex, 1)
    } else {
      const { id } = action.payload
      const dialogIndex = state.history.findIndex(h => h.id === id)
      if (dialogIndex < 0) {
        return
      }

      // TODO(tec27): Track other dialogs opened by this dialog so we can close those too
      state.history.splice(dialogIndex, 1)
    }
  },

  // TODO(tec27): This doesn't make much sense now, there are plenty of dialogs that don't depend
  // on network state
  ['@network/disconnect']() {
    return DEFAULT_DIALOG_HISTORY_STATE
  },
})
