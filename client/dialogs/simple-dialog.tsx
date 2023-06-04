import React from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const buttons = hasButton
    ? [
        <TextButton
          label={t('common.literals.okay', 'Okay')}
          key={'okay'}
          color={'accent'}
          onClick={onCancel}
        />,
      ]
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
