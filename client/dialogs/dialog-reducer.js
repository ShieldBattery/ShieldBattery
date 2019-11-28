import { Record } from 'immutable'
import { DIALOG_OPEN, DIALOG_CLOSE } from '../actions'
import keyedReducer from '../reducers/keyed-reducer'

export const Dialog = new Record({
  isDialogOpened: false,
  dialogType: null,
  title: '',
  content: '',
  action: null,
})

export default keyedReducer(new Dialog(), {
  [DIALOG_OPEN](state, action) {
    return new Dialog({
      isDialogOpened: true,
      dialogType: action.payload.dialogType,
      title: action.payload.title,
      content: action.payload.content,
      action: action.payload.action,
    })
  },

  [DIALOG_CLOSE](state, action) {
    return new Dialog()
  },
})
