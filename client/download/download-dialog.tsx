import React from 'react'
import styled from 'styled-components'
import Dialog from '../material/dialog'
import Download from './download'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

interface DownloadDialogProps {
  dialogRef: React.Ref<any>
  onCancel?: () => void
}

export default function DownloadDialog(props: DownloadDialogProps) {
  return (
    <StyledDialog onCancel={props.onCancel} showCloseButton={true} dialogRef={props.dialogRef}>
      <Download />
    </StyledDialog>
  )
}
