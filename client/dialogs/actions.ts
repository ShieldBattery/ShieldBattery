import { DialogPayload, DialogType } from './dialog-type'

export type DialogActions = OpenDialog | CloseDialog

export interface OpenDialog {
  type: '@dialogs/open'
  payload: DialogPayload
  meta: {
    id: string
  }
}

export interface CloseDialog {
  type: '@dialogs/close'
  payload: {
    dialogType: DialogType | 'all'
  }
}
