import { Map, Record } from 'immutable'
import { keyedReducer } from '../reducers/keyed-reducer'
import { DialogType } from './dialog-type'

export class DialogState extends Record({
  isDialogOpened: false,
  dialogType: null as DialogType | null,
  initData: Map(),
}) {}

export default keyedReducer(new DialogState(), {
  ['@dialogs/open'](state, action) {
    return new DialogState({
      isDialogOpened: true,
      dialogType: action.payload.dialogType,
      initData: Map(Object.entries(action.payload.initData)),
    })
  },

  ['@dialogs/close'](state, action) {
    return new DialogState()
  },
})
