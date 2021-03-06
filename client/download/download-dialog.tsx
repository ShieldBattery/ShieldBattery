import React from 'react'
import styled from 'styled-components'
import Dialog from '../material/dialog'
import Download from './download'

const StyledDialog = styled(Dialog)`
  width: 448px;
`

interface DownloadDialogProps {
  onCancel?: () => void
}

export default function DownloadDialog(props: DownloadDialogProps) {
  return (
    <StyledDialog onCancel={props.onCancel} showCloseButton={true}>
      <Download />
    </StyledDialog>
  )
}
