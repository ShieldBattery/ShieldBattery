import { DIALOG_OPEN, DIALOG_CLOSE } from '../actions'

export function openDialog(dialogType) {
  return {
    type: DIALOG_OPEN,
    dialogType
  }
}

export function closeDialog() {
  return {
    type: DIALOG_CLOSE
  }
}
