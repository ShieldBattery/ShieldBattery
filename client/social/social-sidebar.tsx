import keycode from 'keycode'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
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
import { useWindowSize } from '../dom/dimension-hooks'
import { FocusTrap } from '../dom/focus-trap'
import { useOverflowingElement } from '../dom/overflowing-element'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { IconButton, keyEventMatches, OutlinedButton, useButtonState } from '../material/button'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip } from '../material/tooltip'
import { zIndexMenu, zIndexMenuBackdrop } from '../material/zindex'
import { NavigationTrackerProvider, useNavigationTracker } from '../navigation/navigation-tracker'
import { push } from '../navigation/routing'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { dialogScrimOpacity } from '../styles/colors'
import { labelMedium, singleLine, titleSmall } from '../styles/typography'
import { getBatchUserInfo } from '../users/action-creators'
import { FriendsList } from '../users/friends-list'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { useUserOverlays } from '../users/user-overlays'
import { closeWhisperSession } from '../whispers/action-creators'

/** The width the window must be greater than for pinning to be enabled. */
export const CAN_PIN_WIDTH = 1280

const ALT_E = { keyCode: keycode('e'), altKey: true }
const ALT_H = { keyCode: keycode('h'), altKey: true }

enum SocialTab {
  Chat = 'chat',
  Friends = 'friends',
}

const Scrim = styled(m.div)`
  position: fixed;
  left: 0;
  top: var(--sb-system-bar-height, 0);
  right: 0;
  bottom: 0;
  background-color: var(--theme-dialog-scrim);
  opacity: var(--theme-dialog-scrim-opacity);
  z-index: ${zIndexMenuBackdrop};
`

const rootCss = css`
  ${elevationPlus1};

  width: 100%;
  min-width: var(--sb-sidebar-width);
  height: 100%;

  display: flex;
  flex-direction: column;

  background-color: var(--theme-container-lowest);
  border-radius: 12px 0 0 12px;
  overflow-x: hidden;
`

const RootPinned = styled.div`
  ${rootCss};

  position: relative;
  grid-area: sidebar;
`

const RootOverlay = styled(m.div)`
  ${rootCss};
  position: fixed;
  right: 0;
  width: var(--sb-sidebar-width);
  top: var(--sb-system-bar-height, 0);
  height: calc(100vh - var(--sb-system-bar-height, 0));
  z-index: ${zIndexMenu};
`

const SectionSpacer = styled.hr`
  border: none;
  margin-block: 16px 8px;
`

const TabsAndPin = styled.div`
  margin: 8px 0 0;
  padding-inline: 8px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const PinButton = styled(IconButton)`
  border: 1px solid var(--theme-outline-variant);
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

const ChatSpacer = styled.div`
  height: 8px;
`

export function SocialSidebar({
  className,
  visible,
  pinned,
  onVisibilityChange,
  onPinnedChange,
}: {
  className?: string
  visible: boolean
  pinned: boolean
  onVisibilityChange: (visible: boolean) => void
  onPinnedChange: (pinned: boolean) => void
}) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState(SocialTab.Chat)
  const [windowWidth] = useWindowSize()

  const focusableRef = useRef<HTMLSpanElement>(null)

  const friendActivityStatus = useAppSelector(s => s.relationships.friendActivityStatus)
  const friendCount = useMemo(() => {
    return Array.from(friendActivityStatus.values()).filter(
      status => status !== FriendActivityStatus.Offline,
    ).length
  }, [friendActivityStatus])

  const canPin = !windowWidth || windowWidth > CAN_PIN_WIDTH
  const actuallyPinned = pinned && canPin

  const [doInitialAnim, setDoInitialAnim] = useState(actuallyPinned)

  useEffect(() => {
    setDoInitialAnim(!actuallyPinned && !visible)
  }, [actuallyPinned, visible])

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (keyEventMatches(event, ALT_H)) {
        if (!visible) {
          setActiveTab(SocialTab.Chat)
          onVisibilityChange(true)
        } else if (activeTab !== SocialTab.Chat) {
          setActiveTab(SocialTab.Chat)
        } else {
          onVisibilityChange(false)
        }
        return true
      } else if (keyEventMatches(event, ALT_E)) {
        if (!visible) {
          setActiveTab(SocialTab.Friends)
          onVisibilityChange(true)
        } else if (activeTab !== SocialTab.Friends) {
          setActiveTab(SocialTab.Friends)
        } else {
          onVisibilityChange(false)
        }
        return true
      }

      return false
    },
  })

  const content = (
    <NavigationTrackerProvider
      onNavigation={() => {
        if (!actuallyPinned) {
          onVisibilityChange(false)
        }
      }}>
      <TabsAndPin>
        {canPin ? (
          <Tooltip
            text={
              pinned
                ? t('social.sidebar.unpinTooltip', 'Unpin sidebar')
                : t('social.sidebar.pinTooltip', 'Pin sidebar')
            }
            position='left'
            tabIndex={-1}>
            <PinButton
              icon={<MaterialIcon icon='keep' filled={pinned} />}
              onClick={() => onPinnedChange(!pinned)}
            />
          </Tooltip>
        ) : null}
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
      </TabsAndPin>
      <span ref={focusableRef} tabIndex={-1} />
      {activeTab === SocialTab.Chat ? (
        <>
          <ChatSpacer />
          <ChatContent />
        </>
      ) : (
        <FriendsListContainer>
          <FriendsList />
        </FriendsListContainer>
      )}
    </NavigationTrackerProvider>
  )

  if (actuallyPinned) {
    return (
      <RootPinned className={className} data-test='social-sidebar'>
        {content}
      </RootPinned>
    )
  } else {
    return (
      <AnimatePresence>
        {visible ? (
          <>
            <Scrim
              key='scrim'
              onClick={() => onVisibilityChange(false)}
              variants={{
                initial: { opacity: 0 },
                animate: { opacity: dialogScrimOpacity },
                exit: { opacity: 0 },
              }}
              initial='initial'
              animate='animate'
              exit='exit'
              transition={{
                type: 'spring',
                duration: 0.3,
                bounce: 0,
              }}
            />
            <RootOverlay
              key='sidebar'
              className={className}
              data-test='social-sidebar'
              variants={{
                initial: { x: '100%' },
                animate: { x: '0%' },
                exit: { x: '200%' },
              }}
              initial={doInitialAnim ? 'initial' : false}
              animate='animate'
              exit='exit'
              transition={{
                type: 'spring',
                duration: 0.4,
                bounce: 0,
              }}>
              <FocusTrap focusableRef={focusableRef}>{content}</FocusTrap>
            </RootOverlay>
          </>
        ) : null}
      </AnimatePresence>
    )
  }
}

const Subheader = styled.div`
  ${labelMedium};
  ${singleLine};
  padding-inline: 16px 8px;

  color: var(--theme-on-surface-variant);
  line-height: 24px;
`

const ChatListButton = styled(OutlinedButton)`
  margin: 8px auto 0;
`

function ChatContent() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const chatChannels = useAppSelector(s => s.chat.joinedChannels)
  const whisperSessions = useAppSelector(s => s.whispers.sessions)
  const { onNavigation } = useNavigationTracker()

  return (
    <>
      <Subheader>{t('navigation.leftNav.chatChannels', 'Chat channels')}</Subheader>
      {Array.from(chatChannels.values(), c => (
        <ChannelEntry
          key={c}
          channelId={c}
          onLeave={(channelId: SbChannelId) => {
            dispatch(leaveChannel(channelId))
          }}
        />
      ))}
      <ChatListButton
        onClick={() => {
          if (location.pathname !== '/chat/list') {
            push('/chat/list')
          }
          onNavigation()
        }}
        label={t('chat.channelList.browseChannels', 'Browse channels')}
        iconStart={<MaterialIcon icon='add' size={20} />}
      />
      <SectionSpacer />
      <Subheader>{t('navigation.leftNav.whispers', 'Whispers')}</Subheader>
      {Array.from(whisperSessions.values(), w => (
        <WhisperEntry key={w} userId={w} />
      ))}
      <ChatListButton
        onClick={() => {
          dispatch(openDialog({ type: DialogType.Whispers }))
          onNavigation()
        }}
        label={t('chat.whispers.startWhisperButton', 'Start a whisper')}
        iconStart={<MaterialIcon icon='add' size={20} />}
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
  const { onNavigation } = useNavigationTracker()

  useEffect(() => {
    dispatch(getBatchChannelInfo(channelId))
  }, [dispatch, channelId])

  const button = (
    <IconButton
      icon={<MaterialIcon icon='close' />}
      title={t('chat.navEntry.leaveChannel', 'Leave channel')}
      onClick={event => {
        event.preventDefault()
        onLeave(channelId)
      }}
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
      icon={<ConnectedChannelBadge channelId={channelId} />}
      onClick={event => {
        if (!event.defaultPrevented) {
          onNavigation()
        }
      }}>
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
  const { onNavigation } = useNavigationTracker()

  const { isOverlayOpen, contextMenuProps, onContextMenu } = useUserOverlays<HTMLSpanElement>({
    userId,
  })

  useEffect(() => {
    dispatch(getBatchUserInfo(userId))
  }, [dispatch, userId])

  const button = (
    <IconButton
      icon={<MaterialIcon icon='close' />}
      title={t('whispers.navEntry.closeWhisper', 'Close whisper')}
      onClick={event => {
        event.preventDefault()
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
      }}
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
        onContextMenu={onContextMenu}
        onClick={event => {
          if (!event.defaultPrevented) {
            onNavigation()
          }
        }}>
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
  flex-shrink: 0;
  height: 100%;
  margin-left: 8px;

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
  margin-right: 16px;
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
  onClick?: (event: React.MouseEvent) => void
}

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
  onClick,
}: EntryProps) {
  // Just ensure this component re-renders when the pathname changes, but we grab the pathname
  // directly to avoid wouter's annoying unescaping behavior
  useLocation()
  const currentPath = location.pathname

  const [buttonProps, rippleRef] = useButtonState({ onClick })
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
      <EntryText ref={textRef} title={isOverflowing ? title : undefined} data-test='entry-text'>
        {children}
      </EntryText>
      {button ? <EntryButton>{button}</EntryButton> : null}

      <EntryRipple ref={rippleRef} />
    </EntryRoot>
  )
}
