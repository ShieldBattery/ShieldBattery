import React, { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Markdown } from '../markdown/markdown'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { CommonDialogProps } from './common-dialog-props'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

export interface MarkdownDialogProps extends CommonDialogProps {
  title: string
  markdownContent: string
  hasButton?: boolean
}

export function MarkdownDialog({
  title,
  markdownContent,
  hasButton = false,
  onCancel,
}: MarkdownDialogProps) {
  const { t } = useTranslation()
  const buttons = hasButton
    ? [
        <TextButton
          label={t('common.actions.okay', 'Okay')}
          key={'okay'}
          color={'accent'}
          onClick={onCancel}
        />,
      ]
    : []

  return (
    <StyledDialog title={title} onCancel={onCancel} showCloseButton={true} buttons={buttons}>
      <Suspense fallback={<LoadingDotsArea />}>
        <Markdown source={markdownContent} />
      </Suspense>
    </StyledDialog>
  )
}
