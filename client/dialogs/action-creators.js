import { DIALOG_OPEN, DIALOG_CLOSE } from '../actions'

export function openDialog(dialogType, simpleTitle = undefined, simpleContent = undefined) {
  return {
    type: DIALOG_OPEN,
    payload: {
      dialogType,
      simpleTitle,
      simpleContent,
    },
  }
}

export function openSimpleDialog(simpleTitle, simpleContent) {
  return openDialog('simple', simpleTitle, simpleContent)
}

export function closeDialog() {
  return {
    type: DIALOG_CLOSE,
  }
}
