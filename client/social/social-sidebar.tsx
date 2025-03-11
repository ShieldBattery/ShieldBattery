import keycode from 'keycode'
import React, { MouseEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link, useLocation } from 'wouter'
import { SbChannelId } from '../../common/chat'
import { CAN_LEAVE_SHIELDBATTERY_CHANNEL } from '../../common/flags'
import { urlPath } from '../../common/urls'
import { FriendActivityStatus } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import { getBatchChannelInfo, leaveChannel } from '../chat/action-creators'
import { ConnectedChannelBadge } from '../chat/channel-badge'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useOverflowingElement } from '../dom/overflowing-element'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { ElevatedButton, IconButton, keyEventMatches, useButtonState } from '../material/button'
import { Ripple } from '../material/ripple'
import { TabItem, Tabs } from '../material/tabs'
import { push } from '../navigation/routing'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { useStableCallback } from '../state-hooks'
import { labelMedium, singleLine, titleSmall } from '../styles/typography'
import { getBatchUserInfo } from '../users/action-creators'
import { FriendsList } from '../users/friends-list'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { useUserOverlays } from '../users/user-overlays'
import { closeWhisperSession } from '../whispers/action-creators'

const ALT_E = { keyCode: keycode('e'), altKey: true }

enum SocialTab {
  Chat = 'chat',
  Friends = 'friends',
}

const Root = styled.div`
  position: relative;
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;

  background-color: var(--theme-container-lowest);
  border-radius: 12px 0 0 12px;
  overflow-x: hidden;

  contain: content;

  &:after {
    position: absolute;
    inset: 0;

    content: '';
    border-left: 1px solid var(--theme-outline);
    border-radius: inherit;

    pointer-events: none;
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
  margin: 8px auto 0;
  padding: 8px 0;
`

const FriendsListContainer = styled.div`
  flex-grow: 1;

  display: flex;
  flex-direction: column;
`

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

const Subheader = styled.div`
  ${labelMedium};
  ${singleLine};
  padding-inline: 16px 8px;

  color: var(--theme-on-surface-variant);
  line-height: 24px;
`

// TODO(tec27): Use an outlined or tonal button instead when it has been implemented
const ChatListButton = styled(ElevatedButton)`
  margin: 8px auto 0;
`

function ChatContent() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const chatChannels = useAppSelector(s => s.chat.joinedChannels)
  const whisperSessions = useAppSelector(s => s.whispers.sessions)

  const onChannelLeave = useStableCallback((channelId: SbChannelId) => {
    dispatch(leaveChannel(channelId))
  })
  const onBrowseChannelsClick = useStableCallback(() => {
    if (location.pathname !== '/chat/list') {
      push('/chat/list')
    }
  })
  const onAddWhisperClick = useStableCallback(() => {
    dispatch(openDialog({ type: DialogType.Whispers }))
  })

  return (
    <>
      <Subheader>{t('navigation.leftNav.chatChannels', 'Chat channels')}</Subheader>
      {Array.from(chatChannels.values(), c => (
        <ChannelEntry key={c} channelId={c} onLeave={onChannelLeave} />
      ))}
      <ChatListButton
        onClick={onBrowseChannelsClick}
        label={t('chat.channelList.browseChannels', 'Browse channels')}
        iconStart={<MaterialIcon icon='add' />}
      />
      <SectionSpacer />
      <Subheader>{t('navigation.leftNav.whispers', 'Whispers')}</Subheader>
      {Array.from(whisperSessions.values(), w => (
        <WhisperEntry key={w} userId={w} />
      ))}
      <ChatListButton
        onClick={onAddWhisperClick}
        label={t('chat.whispers.startWhisperButton', 'Start a whisper')}
        iconStart={<MaterialIcon icon='add' />}
      />
    </>
  )
}

function ChannelEntry({
  channelId,
  onLeave,
}: {
  channelId: SbChannelId
  onLeave: (channelId: SbChannelId) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const basicInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const hasUnread = useAppSelector(s => s.chat.unreadChannels.has(channelId))

  const onLeaveClick = useStableCallback((event: MouseEvent) => {
    event.preventDefault()
    onLeave(channelId)
  })

  useEffect(() => {
    dispatch(getBatchChannelInfo(channelId))
  }, [dispatch, channelId])

  const button = (
    <IconButton
      icon={<MaterialIcon icon='close' />}
      title={t('chat.navEntry.leaveChannel', 'Leave channel')}
      onClick={onLeaveClick}
    />
  )

  const displayName = basicInfo?.name ? (
    <span>#{basicInfo.name}</span>
  ) : (
    <LoadingName aria-label={'Channel name loading…'}>
      &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;
    </LoadingName>
  )

  return (
    <Entry
      link={urlPath`/chat/${channelId}/${basicInfo?.name}`}
      needsAttention={hasUnread}
      title={basicInfo ? `#${basicInfo.name}` : undefined}
      button={channelId !== 1 || CAN_LEAVE_SHIELDBATTERY_CHANNEL ? button : null}
      icon={<ConnectedChannelBadge channelId={channelId} />}>
      {displayName}
    </Entry>
  )
}

function WhisperEntry({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const dispatch = useAppDispatch()
  const username = useAppSelector(s => s.users.byId.get(userId)?.name)
  const hasUnread = useAppSelector(s => s.whispers.byId.get(userId)?.hasUnread ?? false)
  const isBlocked = useAppSelector(s => s.relationships.blocks.has(userId))

  const { isOverlayOpen, contextMenuProps, onContextMenu } = useUserOverlays<HTMLSpanElement>({
    userId,
  })

  const onClose = useStableCallback((userId: SbUserId) => {
    dispatch(
      closeWhisperSession(userId, {
        onSuccess: () => {},
        onError: err => {
          snackbarController.showSnackbar(
            t('navigation.leftNav.whisperCloseError', {
              defaultValue: 'Error closing whisper session: {{errorMessage}}',
              errorMessage: err.message,
            }),
            DURATION_LONG,
          )
        },
      }),
    )
  })

  useEffect(() => {
    dispatch(getBatchUserInfo(userId))
  }, [dispatch, userId])

  const button = (
    <IconButton
      icon={<MaterialIcon icon='close' />}
      title={t('whispers.navEntry.closeWhisper', 'Close whisper')}
      onClick={() => onClose(userId)}
    />
  )

  const usernameElem = username ?? (
    <LoadingName aria-label={'Username loading…'}>
      &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;
    </LoadingName>
  )

  return isBlocked ? null : (
    <>
      <ConnectedUserContextMenu {...contextMenuProps} />

      <Entry
        link={urlPath`/whispers/${userId}/${username ?? ''}`}
        button={button}
        icon={<ConnectedAvatar userId={userId} />}
        needsAttention={hasUnread}
        isActive={isOverlayOpen}
        onContextMenu={onContextMenu}>
        {usernameElem}
      </Entry>
    </>
  )
}

const LoadingName = styled.span`
  margin-right: 0.25em;
  background-color: var(--theme-skeleton);
  border-radius: 4px;
`

const EntryRoot = styled(Link)<{ $isCurrentPath: boolean; $isActive?: boolean }>`
  position: relative;
  height: 56px;
  margin: 0;
  padding-inline: 16px 4px;

  display: flex;
  align-items: center;
  gap: 16px;

  --_state-bg: ${props =>
    props.$isCurrentPath || props.$isActive ? 'var(--theme-grey-blue-container)' : 'transparent'};
  --_color: ${props => (props.$isCurrentPath ? 'var(--color-amber80)' : 'currentColor')};
  --sb-ripple-color: var(--theme-on-grey-blue-container);

  &:link,
  &:visited,
  &:hover,
  &:active {
    color: var(--_color);
    text-decoration: none;
  }

  &:before {
    position: absolute;
    left: 8px;
    right: 4px;
    height: 100%;

    background-color: var(--_state-bg);
    border-radius: 4px;
    content: '';
    pointer-events: none;
    z-index: -1;
  }
`

const EntryText = styled.span`
  ${titleSmall};
  ${singleLine};

  flex-grow: 1;
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
`

const EntryButton = styled.div`
  height: 100%;
  flex-shrink: 0;

  display: flex;
  align-items: center;

  opacity: 0;

  ${EntryRoot}:hover &, ${EntryRoot}:focus-within & {
    opacity: 1;
  }
`

const AttentionIndicator = styled.div`
  width: 8px;
  height: 8px;
  position: absolute;
  left: -3px;
  top: calc(50% - 4px);

  border-radius: 50%;
  background-color: var(--color-amber80);
`

const EntryIcon = styled.div`
  flex-shrink: 0;
  width: 40px;
  height: 40px;
`

const EntryRipple = styled(Ripple)`
  position: absolute;
  left: 8px;
  right: 4px;
  height: 100%;

  border-radius: 4px;
`

interface EntryProps {
  link: string
  children: React.ReactNode
  title?: string
  button?: React.ReactNode
  icon?: React.ReactNode
  needsAttention?: boolean
  isActive?: boolean
  className?: string
  onContextMenu?: (event: React.MouseEvent) => void
}

// TODO(2Pac): Try to rework this component to make it more customizable, so it could be used in all
// nav-entries. Or, remove this component and instead only export smaller components that encompass
// common functionality/design across all the nav-entries, and leave it to specific nav-entries to
// use those smaller components to create a nav-entry to their liking.
function Entry({
  link,
  title,
  button,
  icon,
  needsAttention,
  isActive,
  className,
  children,
  onContextMenu,
}: EntryProps) {
  // Just ensure this component re-renders when the pathname changes, but we grab the pathname
  // directly to avoid wouter's annoying unescaping behavior
  useLocation()
  const currentPath = location.pathname

  const [buttonProps, rippleRef] = useButtonState({})
  // TODO(tec27): Would probably be better to pass a route string and do `useRoute` so we can handle
  // having the incorrect name of the entity we're linking to
  const isCurrentPath = link.toLowerCase() === currentPath.toLowerCase()
  const [textRef, isOverflowing] = useOverflowingElement()

  return (
    <EntryRoot
      {...buttonProps}
      to={link}
      $isCurrentPath={isCurrentPath}
      $isActive={isActive}
      className={className}
      onContextMenu={onContextMenu}>
      {icon ? <EntryIcon>{icon}</EntryIcon> : null}
      {needsAttention ? <AttentionIndicator /> : null}
      <EntryText ref={textRef} title={isOverflowing ? title : undefined}>
        {children}
      </EntryText>
      {button ? <EntryButton>{button}</EntryButton> : null}

      <EntryRipple ref={rippleRef} />
    </EntryRoot>
  )
}
