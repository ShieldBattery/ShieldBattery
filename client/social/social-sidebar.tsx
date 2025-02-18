import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useLocation } from 'wouter'
import { SbChannelId } from '../../common/chat'
import { urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user'
import { leaveChannel } from '../chat/action-creators'
import { ChatNavEntry } from '../chat/nav-entry'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { ClickableSubheader } from '../material/left-nav/clickable-subheader'
import Section from '../material/left-nav/section'
import Subheader from '../material/left-nav/subheader'
import SubheaderButton from '../material/left-nav/subheader-button'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { useStableCallback } from '../state-hooks'
import { closeWhisperSession } from '../whispers/action-creators'
import { ConnectedWhisperNavEntry } from '../whispers/nav-entry'

const Root = styled.div`
  position: relative;
  width: 100%;
  height: calc(100% + 8px);
  margin-top: -8px;

  background-color: var(--theme-surface);
  overflow-x: hidden;

  &:before {
    position: absolute;
    width: 1px;
    height: 100%;
    left: 0;

    content: '';
    background-color: var(--theme-outline);
  }
`

const SectionSpacer = styled.hr`
  border: none;
  margin-top: 16px;
`

// TODO(tec27): Move off left-nav styling (can probably delete those components now?)
export function SocialSidebar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const chatChannels = useAppSelector(s => s.chat.joinedChannels)
  const whisperSessions = useAppSelector(s => s.whispers.sessions)

  const onChannelLeave = useStableCallback((channelId: SbChannelId) => {
    dispatch(leaveChannel(channelId))
  })
  const onAddWhisperClick = useStableCallback(() => {
    dispatch(openDialog({ type: DialogType.Whispers }))
  })
  const onWhisperClose = useStableCallback((userId: SbUserId) => {
    dispatch(
      closeWhisperSession(userId, {
        onSuccess: () => {},
        onError: err => {
          dispatch(
            openSnackbar({
              message: t('navigation.leftNav.whisperCloseError', {
                defaultValue: 'Error closing whisper session: {{errorMessage}}',
                errorMessage: err.message,
              }),
              time: TIMING_LONG,
            }),
          )
        },
      }),
    )
  })

  const addWhisperButton = (
    <Tooltip
      text={t('navigation.leftNav.startWhisper', 'Start a whisper (Alt + W)')}
      position='right'>
      <SubheaderButton icon={<MaterialIcon icon='add' />} onClick={onAddWhisperClick} />
    </Tooltip>
  )

  return (
    <Root className={className}>
      <Tooltip
        text={t('navigation.leftNav.joinChannel', 'Join a channel (Alt + H)')}
        position='right'>
        <ClickableSubheader href={urlPath`/chat/list`} icon={<MaterialIcon icon='add' />}>
          {t('navigation.leftNav.chatChannels', 'Chat channels')}
        </ClickableSubheader>
      </Tooltip>
      <Section>
        {Array.from(chatChannels.values(), c => (
          <ConnectedChatNavEntry key={c} channelId={c} onLeave={onChannelLeave} />
        ))}
      </Section>
      <SectionSpacer />
      <Subheader button={addWhisperButton}>
        {t('navigation.leftNav.whispers', 'Whispers')}
      </Subheader>
      <Section>
        {Array.from(whisperSessions.values(), w => (
          <ConnectedWhisperNavEntry key={w} userId={w} onClose={onWhisperClose} />
        ))}
      </Section>
    </Root>
  )
}

function ConnectedChatNavEntry({
  channelId,
  onLeave,
}: {
  channelId: SbChannelId
  onLeave: (channelId: SbChannelId) => void
}) {
  const { t } = useTranslation()
  const channelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const hasUnread = useAppSelector(s => s.chat.unreadChannels.has(channelId))
  const [pathname] = useLocation()

  return (
    <ChatNavEntry
      channelId={channelId}
      channelName={channelInfo?.name ?? t('navigation.leftNav.loadingChannel', 'Loading…')}
      currentPath={pathname}
      hasUnread={hasUnread}
      onLeave={onLeave}
    />
  )
}
