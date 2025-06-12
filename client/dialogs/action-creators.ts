import cuid from 'cuid'
import * as React from 'react'
import { CloseDialog, OpenDialog } from './actions'
import { DialogPayload, DialogType } from './dialog-type'

export function openDialog(payload: DialogPayload): OpenDialog {
  return {
    type: '@dialogs/open',
    payload,
    meta: {
      id: cuid(),
    },
  }
}

export function openSimpleDialog(
  simpleTitle: string,
  simpleContent: React.ReactNode,
  hasButton = true,
): OpenDialog {
  return openDialog({
    type: DialogType.Simple,
    initData: { simpleTitle, simpleContent, hasButton },
  })
}

export function closeDialog(dialogType: DialogType | 'all'): CloseDialog {
  return {
    type: '@dialogs/close',
    payload: {
      dialogType,
    },
  }
}
