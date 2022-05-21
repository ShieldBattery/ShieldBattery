import React from 'react'
import { ThunkAction } from '../dispatch-registry'
import { isStarcraftHealthy } from '../starcraft/is-starcraft-healthy'
import { CloseDialog, OpenDialog } from './actions'
import { DialogPayload, DialogType } from './dialog-type'

export function openDialog(payload: DialogPayload): ThunkAction {
  return (dispatch, getState) => {
    const { starcraft } = getState()

    if (payload.type === DialogType.Settings && !isStarcraftHealthy({ starcraft })) {
      dispatch({
        type: '@dialogs/open',
        payload: {
          type: DialogType.StarcraftPath,
        },
      })
    } else {
      dispatch({
        type: '@dialogs/open',
        payload,
      })
    }
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
