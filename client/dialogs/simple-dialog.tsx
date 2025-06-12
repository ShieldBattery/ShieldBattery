import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { BodyLarge } from '../styles/typography'
import { CommonDialogProps } from './common-dialog-props'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

export interface SimpleDialogProps extends CommonDialogProps {
  simpleTitle: string
  simpleContent: React.ReactNode
  hasButton: boolean
}

export function SimpleDialog({
  simpleTitle,
  simpleContent,
  onCancel,
  hasButton,
}: SimpleDialogProps) {
  const { t } = useTranslation()
  const buttons = hasButton
    ? [<TextButton label={t('common.actions.okay', 'Okay')} key={'okay'} onClick={onCancel} />]
    : []
  const content =
    typeof simpleContent === 'string' ? <BodyLarge>{simpleContent}</BodyLarge> : simpleContent

  return (
    <StyledDialog title={simpleTitle} onCancel={onCancel} showCloseButton={true} buttons={buttons}>
      {content}
    </StyledDialog>
  )
}
