import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { IconButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { useAppSelector } from '../redux-hooks'

const UnreadIndicator = styled.div`
  width: 12px;
  height: 12px;
  position: absolute;
  left: 6px;
  top: 10px;

  background-color: var(--color-amber80);
  border-radius: 50%;
  border: 2px solid rgb(from var(--color-grey-blue10) r g b / 100%);

  pointer-events: none;
`

const ButtonContainer = styled.div`
  width: 48px;
  height: 48px;
  position: relative;

  display: flex;
  align-items: center;
  justify-content: flex-end;

  contain: layout;
`

export interface SocialSidebarButtonProps {
  onClick: () => void
  icon: React.ReactNode
  isOpen?: boolean
}

export function SocialSidebarButton({ onClick, icon, isOpen }: SocialSidebarButtonProps) {
  const { t } = useTranslation()

  const hasUnreadChat = useAppSelector(s => s.chat.unreadChannels.size > 0)
  const hasUnreadWhispers = useAppSelector(s => s.whispers.byId.values().some(w => w.hasUnread))

  return (
    <ButtonContainer>
      <Tooltip
        text={t('social.sidebar.buttonTooltip', 'Toggle social (ALT + H)')}
        position='bottom'
        tabIndex={-1}>
        <IconButton icon={icon} onClick={onClick} testName='social-sidebar-button' />
      </Tooltip>
      {!isOpen && (hasUnreadChat || hasUnreadWhispers) ? <UnreadIndicator /> : null}
    </ButtonContainer>
  )
}
