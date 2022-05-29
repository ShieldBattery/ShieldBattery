import React from 'react'
import { CloseDialog, OpenDialog } from './actions'
import { DialogPayload, DialogType } from './dialog-type'

export function openDialog(payload: DialogPayload): OpenDialog {
  return {
    type: '@dialogs/open',
    payload,
  }
}

export function openSimpleDialog(
  simpleTitle: string,
  simpleContent: React.ReactNode,
  hasButton = true,
): OpenDialog {
  return {
    type: '@dialogs/open',
    payload: {
      type: DialogType.Simple,
      initData: { simpleTitle, simpleContent, hasButton },
    },
  }
}

export function closeDialog(dialogType: DialogType | 'all'): CloseDialog {
  return {
    type: '@dialogs/close',
    payload: {
      dialogType,
    },
  }
}
