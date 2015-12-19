import { DIALOG_OPEN, DIALOG_CLOSE } from '../actions'
import { Dialog } from './dialog-records'

const initialState = new Dialog()

function open(state, action) {
  return new Dialog({
    isDialogOpened: true,
    dialogType: action.dialogType,
  })
}

function close(state, action) {
  return new Dialog()
}

const handlers = {
  [DIALOG_OPEN]: open,
  [DIALOG_CLOSE]: close,
}

export default function dialogReducer(state = initialState, action) {
  return handlers[action.type] ? handlers[action.type](state, action) : state
}
