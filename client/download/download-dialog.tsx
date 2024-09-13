import React from 'react'
import { styled } from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props.js'
import { Dialog } from '../material/dialog.js'
import Download from './download.js'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

export default function DownloadDialog(props: CommonDialogProps) {
  return (
    <StyledDialog
      title=''
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <Download />
    </StyledDialog>
  )
}
