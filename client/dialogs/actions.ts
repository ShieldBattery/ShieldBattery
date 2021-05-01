import { DialogType } from './dialog-type'

export type DialogActions = OpenDialog | CloseDialog

export interface OpenDialog {
  type: '@dialogs/open'
  payload: {
    dialogType: DialogType
    initData: any // TODO(tec27): Type this based on dialog type
  }
}

export interface CloseDialog {
  type: '@dialogs/close'
}
