import React from 'react'
import styled from 'styled-components'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { Subtitle1 } from '../styles/typography'
import { CommonDialogProps } from './common-dialog-props'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

export interface SimpleDialogProps extends CommonDialogProps {
  simpleTitle: string
  simpleContent: React.ReactNode
  hasButton: boolean
}

export function SimpleDialog(props: SimpleDialogProps) {
  const { simpleTitle, simpleContent, onCancel, hasButton, dialogRef } = props
  const buttons = hasButton
    ? [<TextButton label={'Okay'} key={'okay'} color={'accent'} onClick={onCancel} />]
    : []
  const content =
    typeof simpleContent === 'string' ? <Subtitle1>{simpleContent}</Subtitle1> : simpleContent

  return (
    <StyledDialog
      title={simpleTitle}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={buttons}
      dialogRef={dialogRef}>
      {content}
    </StyledDialog>
  )
}
