import React from 'react'
import { CloseDialog, OpenDialog } from './actions'
import { DialogType } from './dialog-type'

export function openDialog(dialogType: DialogType, initData = {}): OpenDialog {
  return {
    type: '@dialogs/open',
    payload: {
      dialogType,
      initData,
    },
  }
}

export function openSimpleDialog(
  simpleTitle: string,
  simpleContent: React.ReactNode,
  hasButton = true,
): OpenDialog {
  return openDialog(DialogType.Simple, { simpleTitle, simpleContent, hasButton })
}

export function closeDialog(): CloseDialog {
  return {
    type: '@dialogs/close',
  }
}
