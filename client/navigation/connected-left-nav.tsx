import keycode from 'keycode'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UseTransitionProps } from 'react-spring'
import styled from 'styled-components'
import { useLocation } from 'wouter'
import { SbChannelId } from '../../common/chat'
import { MULTI_CHANNEL } from '../../common/flags'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user'
import GameActivityNavEntry from '../active-game/game-activity-nav-entry'
import { logOut } from '../auth/action-creators'
import { useSelfUser } from '../auth/state-hooks'
import { openChangelog } from '../changelog/action-creators'
import { leaveChannel } from '../chat/action-creators'
import { ChatNavEntry } from '../chat/nav-entry'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import DiscordIcon from '../icons/brands/discord.svg'
import GitHubIcon from '../icons/brands/github.svg'
import KofiColorIcon from '../icons/brands/kofi-color.svg'
import PatreonIcon from '../icons/brands/patreon.svg'
import TwitterIcon from '../icons/brands/twitter.svg'
import AddIcon from '../icons/material/add-24px.svg'
import EditIcon from '../icons/material/edit-24px.svg'
import ChangelogIcon from '../icons/material/new_releases-24px.svg'
import PortraitIcon from '../icons/material/portrait-24px.svg'
import LogoutIcon from '../icons/material/power_settings-24px.svg'
import { leaveLobby } from '../lobbies/action-creators'
import LobbyNavEntry from '../lobbies/nav-entry'
import { cancelFindMatch } from '../matchmaking/action-creators'
import { isMatchmakingLoading } from '../matchmaking/matchmaking-reducer'
import { SearchingMatchNavEntry } from '../matchmaking/searching-match-nav-entry'
import { useButtonHotkey } from '../material/button'
import LeftNav from '../material/left-nav/left-nav'
import Section from '../material/left-nav/section'
import Subheader from '../material/left-nav/subheader'
import { SubheaderButton } from '../material/left-nav/subheader-button'
import { Divider as MenuDivider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useAnchorPosition } from '../material/popover'
import { defaultSpring } from '../material/springs'
import { Tooltip } from '../material/tooltip'
import { leaveParty } from '../parties/action-creators'
import { PartyNavEntry } from '../parties/party-nav-entry'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { useValueAsRef } from '../state-hooks'
import { colorTextSecondary } from '../styles/colors'
import { overline, singleLine } from '../styles/typography'
import { getBatchUserInfo, navigateToUserProfile } from '../users/action-creators'
import ProfileNavEntry from '../users/nav-entry'
import { SelfProfileOverlay } from '../users/self-profile-overlay'
import { closeWhisperSession } from '../whispers/action-creators'
import { WhisperNavEntry } from '../whispers/nav-entry'
import Lockup from './lockup'

const ALT_H = { keyCode: keycode('h'), altKey: true }
const ALT_W = { keyCode: keycode('w'), altKey: true }

const SectionSpacer = styled.hr`
  border: none;
  margin-top: 16px;
`

const LockupContainer = styled.div`
  position: relative;
  width: 100%;
`

const AppMenu = styled(MenuList)`
  width: 256px;
  max-height: 420px;
`

const AppMenuOverline = styled.div`
  ${overline};
  ${singleLine};
  color: ${colorTextSecondary};
  padding: 8px 12px 0;
`

const StyledTwitterIcon = styled(TwitterIcon)`
  color: #1d9bf0;
`

const StyledPatreonIcon = styled(PatreonIcon)`
  color: #ff424e;
`

const APP_MENU_LINKS: Array<[text?: string, icon?: React.ReactNode, url?: string]> = [
  ['Discord', <DiscordIcon />, 'https://discord.gg/S8dfMx94a4'],
  ['Twitter', <StyledTwitterIcon />, 'https://twitter.com/ShieldBatteryBW'],
  ['GitHub', <GitHubIcon />, 'https://github.com/ShieldBattery/ShieldBattery'],
  [],
  ['Support the project'],
  ['Patreon', <StyledPatreonIcon />, 'https://patreon.com/tec27'],
  ['GitHub Sponsors', <GitHubIcon />, 'https://github.com/sponsors/ShieldBattery'],
  ['Ko-fi', <KofiColorIcon />, 'https://ko-fi.com/tec27'],
]

const MENU_TRANSITION: UseTransitionProps<boolean> = {
  from: { opacity: 0, scaleY: 0.5 },
  enter: { opacity: 1, scaleY: 1 },
  leave: { opacity: 0, scaleY: 0 },
  config: (item, index, phase) => key =>
    phase === 'leave' || key === 'opacity' ? { ...defaultSpring, clamp: true } : defaultSpring,
}

function LockupAndMenu() {
  const [appMenuAnchor, setAppMenuAnchor] = useState<HTMLElement>()
  const appMenuAnchorRef = useValueAsRef(appMenuAnchor)
  const [, anchorX, anchorY] = useAnchorPosition('center', 'bottom', appMenuAnchor ?? null)
  const onLockupClick = useCallback(
    (event: React.MouseEvent) => {
      if (!appMenuAnchorRef.current) {
        setAppMenuAnchor(event.currentTarget as HTMLElement)
      }
    },
    [appMenuAnchorRef],
  )
  const onAppMenuDismiss = useCallback(() => {
    setAppMenuAnchor(undefined)
  }, [])
  const appMenuItems = useMemo(
    () =>
      APP_MENU_LINKS.map(([text, icon, url], i) => {
        if (text && url) {
          return (
            <MenuItem
              key={i}
              text={text}
              icon={icon}
              onClick={() => {
                window.open(url as string, '_blank')
                setAppMenuAnchor(undefined)
              }}
            />
          )
        } else if (text) {
          return <AppMenuOverline key={i}>{text}</AppMenuOverline>
        } else {
          return <MenuDivider key={i} />
        }
      }),
    [],
  )

  return (
    <LockupContainer>
      <Lockup onClick={onLockupClick} menuOpened={!!appMenuAnchor} />
      <Popover
        open={!!appMenuAnchor}
        onDismiss={onAppMenuDismiss}
        anchorX={(anchorX ?? 0) - 8}
        anchorY={(anchorY ?? 0) + 8}
        originX='center'
        originY='top'
        transitionProps={MENU_TRANSITION}>
        <AppMenu>{appMenuItems}</AppMenu>
      </Popover>
    </LockupContainer>
  )
}

function SearchingMatchSection() {
  const dispatch = useAppDispatch()
  const searchInfo = useAppSelector(s => s.matchmaking.searchInfo)
  const isGameInProgress = useAppSelector(
    s => s.matchmaking.isLaunching || s.matchmaking.isCountingDown || s.matchmaking.isStarting,
  )
  const match = useAppSelector(s => s.matchmaking.match)

  const onCancel = useCallback(() => {
    dispatch(cancelFindMatch())
  }, [dispatch])

  if (!searchInfo || isGameInProgress) {
    return null
  }

  return (
    <>
      <Section key='searching-match-section'>
        <SearchingMatchNavEntry
          isMatched={!!match}
          startTime={searchInfo.startTime}
          matchmakingType={searchInfo.matchmakingType}
          onCancelSearch={onCancel}
        />
      </Section>
      <SectionSpacer key='searching-match-divider' />
    </>
  )
}

function LoadingGameSection() {
  const isLobbyLoading = useAppSelector(s => s.lobby.info.isLoading)
  const lobbyName = useAppSelector(s => s.lobby.info.name)
  const isMatchLoading = useAppSelector(s => isMatchmakingLoading(s.matchmaking))
  const matchmakingType = useAppSelector(s => s.matchmaking.match?.type)
  const matchmakingLaunching = useAppSelector(s => s.matchmaking.isLaunching)
  const matchmakingCountingDown = useAppSelector(s => s.matchmaking.isCountingDown)
  const matchmakingStarting = useAppSelector(s => s.matchmaking.isStarting)
  const [currentPath] = useLocation()

  if (!isLobbyLoading && !isMatchLoading) return null

  let link: string
  let title: string
  if (isLobbyLoading) {
    link = urlPath`/lobbies/${lobbyName}/loading-game`
    title = 'Custom game'
  } else if (isMatchLoading) {
    title = `Ranked ${matchmakingType ? matchmakingTypeToLabel(matchmakingType) : ''}`

    if (matchmakingLaunching) {
      link = '/matchmaking/countdown'
    } else if (matchmakingCountingDown) {
      link = '/matchmaking/countdown'
    } else if (matchmakingStarting) {
      link = '/matchmaking/game-starting'
    } else {
      // This should never really happen but it makes TS happy
      link = '/matchmaking/countdown'
    }
  } else {
    return null
  }

  return (
    <>
      <Section key='loading-game-section'>
        <GameActivityNavEntry
          key='loading-game'
          link={link}
          currentPath={currentPath}
          title={title}
          subtitle='Loading…'
        />
      </Section>
      <SectionSpacer key='loading-game-divider' />
    </>
  )
}

function ActiveGameSection() {
  const isActive = useAppSelector(s => s.activeGame.isActive)
  const gameInfo = useAppSelector(s => s.activeGame.info)
  const [currentPath] = useLocation()

  if (!isActive || !gameInfo) {
    return null
  }

  let link: string
  let title: string
  if (gameInfo.type === 'lobby') {
    link = urlPath`/lobbies/${gameInfo.extra.lobby.info.name}/active-game`
    title = 'Custom game'
  } else if (gameInfo.type === 'matchmaking') {
    link = '/matchmaking/active-game'
    title = `Ranked ${matchmakingTypeToLabel(gameInfo.extra.match.type)}`
  } else {
    return null
  }

  return (
    <>
      <Section key='active-game-section'>
        <GameActivityNavEntry
          key='active-game'
          link={link}
          currentPath={currentPath}
          title={title}
          subtitle='Game in progress…'
        />
      </Section>
      <SectionSpacer key='active-game-divider' />
    </>
  )
}

function LobbySection() {
  const dispatch = useAppDispatch()
  const lobbyName = useAppSelector(s => s.lobby.info.name)
  const hasUnread = useAppSelector(s => s.lobby.hasUnread)
  const inLobby = useAppSelector(s => s.lobby.inLobby)
  const [currentPath] = useLocation()

  const onLeaveLobbyClick = useCallback(() => {
    dispatch(leaveLobby())
  }, [dispatch])

  if (!inLobby) {
    return null
  }

  return (
    <>
      <Subheader key='lobby-header'>Lobby</Subheader>
      <Section key='lobby-section'>
        <LobbyNavEntry
          key='lobby'
          lobby={lobbyName}
          currentPath={currentPath}
          hasUnread={hasUnread}
          onLeaveClick={onLeaveLobbyClick}
        />
      </Section>
      <SectionSpacer key='lobby-divider' />
    </>
  )
}

function PartySection() {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const currentParty = useAppSelector(s => s.party.current)

  const onInviteClick = useCallback(() => {
    dispatch(openDialog({ type: DialogType.PartyInvite }))
  }, [dispatch])
  const onLeaveClick = useCallback(
    (partyId: string) => {
      dispatch(leaveParty(partyId))
    },
    [dispatch],
  )

  if (!currentParty) {
    return null
  }

  const canInvite = selfUser.id === currentParty.leader
  return (
    <>
      <Section key='party-section'>
        <PartyNavEntry
          key='party'
          party={currentParty}
          canInvite={canInvite}
          onInviteUserClick={onInviteClick}
          onLeavePartyClick={onLeaveClick}
        />
      </Section>
      <SectionSpacer key='party-divider' />
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
  const channelInfo = useAppSelector(s => s.chat.idToInfo.get(channelId))
  const hasUnread = useAppSelector(s => s.chat.unreadChannels.has(channelId))
  const [pathname] = useLocation()

  return (
    <ChatNavEntry
      channelId={channelId}
      channelName={channelInfo?.name ?? 'Loading...'}
      currentPath={pathname}
      hasUnread={hasUnread}
      onLeave={onLeave}
    />
  )
}

function ConnectedWhisperNavEntry({
  userId,
  onClose,
}: {
  userId: SbUserId
  onClose: (userId: SbUserId) => void
}) {
  const dispatch = useAppDispatch()
  const username = useAppSelector(s => s.users.byId.get(userId)?.name)
  const hasUnread = useAppSelector(s => s.whispers.byId.get(userId)?.hasUnread ?? false)
  const isBlocked = useAppSelector(s => s.relationships.blocks.has(userId))
  const [pathname] = useLocation()

  useEffect(() => {
    dispatch(getBatchUserInfo(userId))
  }, [dispatch, userId])

  return isBlocked ? null : (
    <WhisperNavEntry
      userId={userId}
      username={username}
      currentPath={pathname}
      hasUnread={hasUnread}
      onClose={onClose}
    />
  )
}

export function ConnectedLeftNav() {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const chatChannels = useAppSelector(s => s.chat.joinedChannels)
  const whisperSessions = useAppSelector(s => s.whispers.sessions)

  const [profileOverlayOpen, setProfileOverlayOpen] = useState(false)
  const profileEntryRef = useRef<HTMLButtonElement>(null)
  const joinChannelButtonRef = useRef<HTMLButtonElement>(null)
  const startWhisperButtonRef = useRef<HTMLButtonElement>(null)

  useButtonHotkey({ ref: joinChannelButtonRef, hotkey: ALT_H })
  useButtonHotkey({ ref: startWhisperButtonRef, hotkey: ALT_W })

  const onProfileEntryClick = useCallback(() => {
    setProfileOverlayOpen(true)
  }, [])
  const onProfileOverlayClose = useCallback(() => {
    setProfileOverlayOpen(false)
  }, [])
  const onLogOutClick = useCallback(() => {
    onProfileOverlayClose()
    dispatch(logOut().action)
  }, [dispatch, onProfileOverlayClose])
  const onChangelogClick = useCallback(() => {
    onProfileOverlayClose()
    dispatch(openChangelog())
  }, [dispatch, onProfileOverlayClose])
  const onEditAccountClick = useCallback(() => {
    onProfileOverlayClose()
    dispatch(openDialog({ type: DialogType.Account }))
  }, [dispatch, onProfileOverlayClose])
  const onViewProfileClick = useCallback(() => {
    onProfileOverlayClose()
    navigateToUserProfile(selfUser.id, selfUser.name)
  }, [onProfileOverlayClose, selfUser.id, selfUser.name])

  const footer = (
    <>
      <ProfileNavEntry
        key='profileEntry'
        ref={profileEntryRef}
        user={selfUser.name}
        onProfileEntryClick={onProfileEntryClick}
        profileMenuOpen={profileOverlayOpen}
      />
    </>
  )

  const onJoinChannelClick = useCallback(() => {
    dispatch(openDialog({ type: DialogType.ChannelJoin }))
  }, [dispatch])
  const onChannelLeave = useCallback(
    (channelId: SbChannelId) => {
      dispatch(leaveChannel(channelId))
    },
    [dispatch],
  )
  const onAddWhisperClick = useCallback(() => {
    dispatch(openDialog({ type: DialogType.Whispers }))
  }, [dispatch])
  const onWhisperClose = useCallback(
    (userId: SbUserId) => {
      dispatch(
        closeWhisperSession(userId, {
          onSuccess: () => {},
          onError: err => {
            dispatch(
              openSnackbar({
                message: `Error closing whisper session: ${err.message}`,
                time: TIMING_LONG,
              }),
            )
          },
        }),
      )
    },
    [dispatch],
  )

  const joinChannelButton = (
    <Tooltip text='Join a channel (Alt + H)' position='right'>
      <SubheaderButton ref={joinChannelButtonRef} icon={<AddIcon />} onClick={onJoinChannelClick} />
    </Tooltip>
  )
  const addWhisperButton = (
    <Tooltip text='Start a whisper (Alt + W)' position='right'>
      <SubheaderButton ref={startWhisperButtonRef} icon={<AddIcon />} onClick={onAddWhisperClick} />
    </Tooltip>
  )

  return (
    <LeftNav header={<LockupAndMenu />} footer={footer}>
      {IS_ELECTRON ? <SearchingMatchSection /> : null}
      {IS_ELECTRON ? <LoadingGameSection /> : null}
      {IS_ELECTRON ? <ActiveGameSection /> : null}
      {IS_ELECTRON ? <LobbySection /> : null}
      {IS_ELECTRON ? <PartySection /> : null}
      <Subheader button={MULTI_CHANNEL ? joinChannelButton : null}>Chat channels</Subheader>
      <Section>
        {Array.from(chatChannels.values(), c => (
          <ConnectedChatNavEntry key={c} channelId={c} onLeave={onChannelLeave} />
        ))}
      </Section>
      <SectionSpacer />
      <Subheader button={addWhisperButton}>Whispers</Subheader>
      <Section>
        {Array.from(whisperSessions.values(), w => (
          <ConnectedWhisperNavEntry key={w} userId={w} onClose={onWhisperClose} />
        ))}
      </Section>

      <SelfProfileOverlay
        open={profileOverlayOpen}
        onDismiss={onProfileOverlayClose}
        anchor={profileEntryRef.current}
        username={selfUser.name}>
        <MenuItem icon={<PortraitIcon />} text='View profile' onClick={onViewProfileClick} />
        <MenuItem icon={<ChangelogIcon />} text='View changelog' onClick={onChangelogClick} />
        <MenuItem icon={<EditIcon />} text='Edit account' onClick={onEditAccountClick} />
        <MenuDivider />
        <MenuItem icon={<LogoutIcon />} text='Log out' onClick={onLogOutClick} />
      </SelfProfileOverlay>
    </LeftNav>
  )
}
