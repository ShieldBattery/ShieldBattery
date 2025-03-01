import keycode from 'keycode'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useLocation } from 'wouter'
import { SbChannelId } from '../../common/chat'
import { urlPath } from '../../common/urls'
import { FriendActivityStatus } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { leaveChannel } from '../chat/action-creators'
import { ChatNavEntry } from '../chat/nav-entry'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { keyEventMatches } from '../material/button'
import { ClickableSubheader } from '../material/left-nav/clickable-subheader'
import Section from '../material/left-nav/section'
import Subheader from '../material/left-nav/subheader'
import SubheaderButton from '../material/left-nav/subheader-button'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { useStableCallback } from '../state-hooks'
import { FriendsList } from '../users/friends-list'
import { closeWhisperSession } from '../whispers/action-creators'
import { ConnectedWhisperNavEntry } from '../whispers/nav-entry'

const ALT_E = { keyCode: keycode('e'), altKey: true }

enum SocialTab {
  Chat = 'chat',
  Friends = 'friends',
}

const Root = styled.div`
  position: relative;
  width: 100%;
  height: calc(100% + 8px);
  padding: 0 8px;

  display: flex;
  flex-direction: column;

  background-color: var(--theme-container-lowest);
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

const TabsContainer = styled.div`
  flex-grow: 0;
  flex-shrink: 0;

  width: min-content;
  margin: 0 auto;
  padding: 8px 0;
`

const FriendsListContainer = styled.div`
  flex-grow: 1;

  display: flex;
  flex-direction: column;
`

// TODO(tec27): Move off left-nav styling (can probably delete those components now?)
export function SocialSidebar({
  className,
  onShowSidebar,
}: {
  className?: string
  onShowSidebar: () => void
}) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState(SocialTab.Chat)

  const friendActivityStatus = useAppSelector(s => s.relationships.friendActivityStatus)
  const friendCount = useMemo(() => {
    return Array.from(friendActivityStatus.values()).filter(
      status => status !== FriendActivityStatus.Offline,
    ).length
  }, [friendActivityStatus])

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (keyEventMatches(event, ALT_E)) {
        setActiveTab(SocialTab.Friends)
        onShowSidebar()
        return true
      }

      return false
    },
  })

  return (
    <Root className={className}>
      <TabsContainer>
        <Tabs activeTab={activeTab} onChange={setActiveTab}>
          <TabItem value={SocialTab.Chat} text={t('social.chat.label', 'Chat')} />
          <TabItem
            value={SocialTab.Friends}
            text={t('social.friends.label', {
              defaultValue: 'Friends ({{friendCount}})',
              friendCount,
            })}
          />
        </Tabs>
      </TabsContainer>
      {activeTab === SocialTab.Chat ? (
        <ChatContent />
      ) : (
        <FriendsListContainer>
          <FriendsList />
        </FriendsListContainer>
      )}
    </Root>
  )
}

function ChatContent() {
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
    <>
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
    </>
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
