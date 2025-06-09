import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { bodyMedium } from '../styles/typography'
import { IconButton, Label, TextButton } from './button'
import { elevationPlus3 } from './shadows'

const Root = styled.div`
  ${elevationPlus3};

  width: auto;
  min-width: 360px;
  max-width: 600px;
  height: auto;
  min-height: 48px;
  padding-left: 16px;

  contain: content;

  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  overflow: hidden;

  background-color: var(--theme-inverse-surface);
  border-radius: 4px;
  color: var(--theme-inverse-on-surface);
  text-align: left;
`

const Message = styled.div`
  ${bodyMedium};
  padding-block: calc(calc(48px - 20px) / 2);

  font-weight: 500;
`

const Buttons = styled.div`
  display: flex;
  align-items: center;
`

const ActionButton = styled(TextButton)`
  color: var(--theme-inverse-primary);
  --sb-ripple-color: var(--theme-inverse-primary);

  & ${Label} {
    font-weight: 600;
  }
`

const CloseButton = styled(IconButton)`
  color: var(--theme-inverse-on-surface);
  --sb-ripple-color: var(--theme-inverse-on-surface);
`

export interface SnackbarProps {
  message: string
  onDismiss: () => void
  actionLabel?: string
  onAction?: () => void
  className?: string
  testName?: string
}

export function Snackbar({
  message,
  onDismiss,
  actionLabel,
  onAction,
  className,
  testName,
}: SnackbarProps) {
  const { t } = useTranslation()

  return (
    <Root className={className} data-test={testName}>
      <Message>{message}</Message>
      <Buttons>
        {actionLabel ? <ActionButton label={actionLabel} onClick={onAction} /> : undefined}
        <CloseButton
          onClick={onDismiss}
          icon={<MaterialIcon icon='close' invertColor={true} />}
          aria-label={t('common.actions.close', 'Close')}
        />
      </Buttons>
    </Root>
  )
}
