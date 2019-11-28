import { DIALOG_OPEN, DIALOG_CLOSE } from '../actions'

export function openDialog(dialogType, title = undefined, content = undefined, action = undefined) {
  return {
    type: DIALOG_OPEN,
    payload: {
      dialogType,
      title,
      content,
      action,
    },
  }
}

export function openSimpleDialog(simpleTitle, simpleContent) {
  return openDialog('simple', simpleTitle, simpleContent)
}

export function openConfirmationDialog(confirmTitle, confirmContent, confirmAction) {
  return openDialog('confirmation', confirmTitle, confirmContent, confirmAction)
}

export function closeDialog() {
  return {
    type: DIALOG_CLOSE,
  }
}
