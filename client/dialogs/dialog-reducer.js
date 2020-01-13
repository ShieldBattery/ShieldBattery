import { Map, Record } from 'immutable'
import { DIALOG_OPEN, DIALOG_CLOSE } from '../actions'
import keyedReducer from '../reducers/keyed-reducer'

export const Dialog = new Record({
  isDialogOpened: false,
  dialogType: null,
  initData: new Map(),
})

export default keyedReducer(new Dialog(), {
  [DIALOG_OPEN](state, action) {
    return new Dialog({
      isDialogOpened: true,
      dialogType: action.payload.dialogType,
      initData: new Map(Object.entries(action.payload.initData)),
    })
  },

  [DIALOG_CLOSE](state, action) {
    return new Dialog()
  },
})
