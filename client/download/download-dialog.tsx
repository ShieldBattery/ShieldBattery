import React from 'react'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import Download from './download'

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
