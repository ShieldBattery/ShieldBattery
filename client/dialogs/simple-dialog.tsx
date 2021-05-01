import React from 'react'
import Dialog from '../material/dialog'
import FlatButton from '../material/flat-button'
import { Subtitle1 } from '../styles/typography'
import { CommonDialogProps } from './common-dialog-props'

export interface SimpleDialogProps extends CommonDialogProps {
  simpleTitle: string
  simpleContent: React.ReactNode
  hasButton: boolean
}

export function SimpleDialog(props: SimpleDialogProps) {
  const { simpleTitle, simpleContent, onCancel, hasButton, dialogRef } = props
  const buttons = hasButton
    ? [<FlatButton label={'Okay'} key={'okay'} color={'accent'} onClick={onCancel} />]
    : []
  const content =
    typeof simpleContent === 'string' ? <Subtitle1>{simpleContent}</Subtitle1> : simpleContent

  return (
    <Dialog
      title={simpleTitle}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={buttons}
      dialogRef={dialogRef}>
      {content}
    </Dialog>
  )
}
