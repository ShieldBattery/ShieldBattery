import { DIALOG_OPEN, DIALOG_CLOSE } from '../actions'

export function openDialog(dialogType, initData = {}) {
  return {
    type: DIALOG_OPEN,
    payload: {
      dialogType,
      initData,
    },
  }
}

export function openSimpleDialog(simpleTitle, simpleContent, hasButton = true) {
  return openDialog('simple', { simpleTitle, simpleContent, hasButton })
}

export function closeDialog() {
  return {
    type: DIALOG_CLOSE,
  }
}
