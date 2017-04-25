import { Record } from 'immutable'
import { DIALOG_OPEN, DIALOG_CLOSE } from '../actions'
import keyedReducer from '../reducers/keyed-reducer'

export const Dialog = new Record({
  isDialogOpened: false,
  dialogType: null,
  simpleTitle: '',
  simpleContent: '',
})

export default keyedReducer(new Dialog(), {
  [DIALOG_OPEN](state, action) {
    return new Dialog({
      isDialogOpened: true,
      dialogType: action.payload.dialogType,
      simpleTitle: action.payload.simpleTitle,
      simpleContent: action.payload.simpleContent,
    })
  },

  [DIALOG_CLOSE](state, action) {
    return new Dialog()
  },
})
