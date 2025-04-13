import keycode from 'keycode'
import React, { MouseEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { Link, useRoute } from 'wouter'
import { getErrorStack } from '../common/errors'
import { matchmakingTypeToLabel } from '../common/matchmaking'
import { urlPath } from '../common/urls'
import { logOut } from './auth/action-creators'
import { redirectToLogin, useIsLoggedIn, useSelfUser } from './auth/auth-utils'
import { useShowEmailVerificationNotificationIfNeeded } from './auth/email-verification-notification-ui'
import { ConnectedAvatar } from './avatars/avatar'
import { openDialog, openSimpleDialog } from './dialogs/action-creators'
import { DialogType } from './dialogs/dialog-type'
import { useBreakpoint } from './dom/dimension-hooks'
import { MaterialIcon } from './icons/material/material-icon'
import { useKeyListener } from './keyboard/key-listener'
import logger from './logging/logger'
import { cancelFindMatch } from './matchmaking/action-creators'
import { ElapsedTime } from './matchmaking/elapsed-time'
import { isMatchmakingLoading } from './matchmaking/matchmaking-reducer'
import {
  ElevatedButton,
  HotkeyProp,
  IconButton,
  keyEventMatches,
  useButtonHotkey,
} from './material/button'
import { emphasizedAccelerateEasing, emphasizedDecelerateEasing } from './material/curve-constants'
import { Divider } from './material/menu/divider'
import { MenuItem } from './material/menu/item'
import { usePopoverController } from './material/popover'
import { Tooltip } from './material/tooltip'
import {
  NavigationMenuItem,
  NavigationMenuOverlay,
  useNavigationMenuState,
} from './navigation/navigation-menu'
import { push } from './navigation/routing'
import { NotificationsButton } from './notifications/activity-bar-entry'
import NotificationPopups from './notifications/notifications-popup'
import { useShowPolicyNotificationsIfNeeded } from './policies/show-notifications'
import { useStableCallback, useUserLocalStorageValue } from './react/state-hooks'
import { useAppDispatch, useAppSelector } from './redux-hooks'
import { openSettings } from './settings/action-creators'
import { SocialSidebar } from './social/social-sidebar'
import { singleLine, sofiaSans, titleSmall } from './styles/typography'
import { navigateToUserProfile } from './users/action-creators'
import { SelfProfileOverlay } from './users/self-profile-overlay'

const ALT_A = { keyCode: keycode('a'), altKey: true }
const ALT_B = { keyCode: keycode('b'), altKey: true }
const ALT_C = { keyCode: keycode('c'), altKey: true }
const ALT_D = { keyCode: keycode('d'), altKey: true }
const ALT_F = { keyCode: keycode('f'), altKey: true }
const ALT_G = { keyCode: keycode('g'), altKey: true }
const ALT_H = { keyCode: keycode('h'), altKey: true }
const ALT_J = { keyCode: keycode('j'), altKey: true }
const ALT_M = { keyCode: keycode('m'), altKey: true }
const ALT_O = { keyCode: keycode('o'), altKey: true }
const ALT_R = { keyCode: keycode('r'), altKey: true }
const ALT_S = { keyCode: keycode('s'), altKey: true }

const SIDEBAR_WIDTH = 320

const Root = styled.div<{ $sidebarOpen?: boolean }>`
  width: 100%;
  height: calc(100% - var(--sb-system-bar-height, 0px));
  overflow: hidden;

  --sb-sidebar-width: ${SIDEBAR_WIDTH}px;

  display: grid;
  grid-template-columns: 0 minmax(min-content, 1fr) ${props =>
      props.$sidebarOpen ? 'var(--sb-sidebar-width)' : '0'};
  grid-template-areas:
    'appbar appbar appbar'
    'padding content sidebar';
  grid-template-rows: auto 1fr;

  transition: grid-template-columns ${props => (props.$sidebarOpen ? '400ms' : '200ms')}
    ${props => (props.$sidebarOpen ? emphasizedDecelerateEasing : emphasizedAccelerateEasing)};

  @media (min-width: ${SIDEBAR_WIDTH + 1248}px) {
    grid-template-columns:
      ${props => (props.$sidebarOpen ? 'calc(100dvw - 1248px - var(--sb-sidebar-width))' : '0')}
      minmax(min-content, 1fr)
      ${props => (props.$sidebarOpen ? 'var(--sb-sidebar-width)' : '0')};
  }

  @media (min-width: ${SIDEBAR_WIDTH * 2 + 1248}px) {
    grid-template-columns:
      ${props => (props.$sidebarOpen ? 'var(--sb-sidebar-width)' : '0')}
      minmax(min-content, 1fr)
      ${props => (props.$sidebarOpen ? 'var(--sb-sidebar-width)' : '0')};
  }
`

const MenuItemRoot = styled.a<{ $isActive?: boolean }>`
  ${singleLine};

  position: relative;
  min-width: 140px;
  height: 64px;
  padding: 0 20px;

  display: block;

  font-size: 22px;
  font-weight: 700;
  line-height: 64px;
  text-align: center;
  text-decoration: none;
  text-shadow: 1px 1px rgb(from var(--color-grey-blue10) r g b / 50%);
  text-transform: uppercase;

  --menu-item-fill: none;

  &:link,
  &:visited {
    color: ${({ $isActive }) => ($isActive ? 'var(--theme-amber)' : 'inherit')};
  }

  @media (hover: hover) {
    &:hover {
      color: ${({ $isActive }) => ($isActive ? 'var(--theme-amber)' : 'var(--theme-on-surface)')};
      text-decoration: none;
      --menu-item-fill: var(--color-grey-blue40);

      &:before {
        content: '';
        position: absolute;
        top: 0;
        left: 20px;
        right: 20px;
        bottom: 0;
        background: var(--menu-item-fill);
      }
    }

    &:focus-visible {
      outline: none;

      &:after {
        content: '';
        position: absolute;
        top: 16px;
        left: 20px;
        right: 20px;
        bottom: 16px;
        outline: 2px solid var(--theme-amber);
        border-radius: 4px;
      }
    }
  }

  &:active {
    color: ${({ $isActive }) => ($isActive ? 'var(--theme-amber)' : 'var(--theme-on-surface)')};
    text-decoration: none;
    --menu-item-fill: var(--color-grey-blue50);

    &:before {
      content: '';
      position: absolute;
      top: 0;
      left: 20px;
      right: 20px;
      bottom: 0;
      background: var(--menu-item-fill);
    }
  }
`

const MenuItemContent = styled.span`
  position: relative;
  display: inline-block;
`

const MenuItemLeftEdge = styled.svg`
  position: absolute;
  left: 0px;
  width: 20px;
  height: 100%;
`

const MenuItemRightEdge = styled.svg`
  position: absolute;
  right: 0px;
  width: 20px;
  height: 100%;
`

const MenuItemLeftActiveStroke = styled(MenuItemLeftEdge)`
  width: 24px;
`
const MenuItemRightActiveStroke = styled(MenuItemRightEdge)`
  width: 24px;
`

const MenuItemBottomActiveStroke = styled.div`
  position: absolute;
  left: 22px;
  right: 22px;
  bottom: 0;
  height: 2px;
  background: var(--theme-amber);
`

function MenuItemStrokeGradient({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1='0' x2='0' y1='0' y2='1'>
        <stop offset='20%' stopColor='var(--theme-amber)' stopOpacity={0} />
        <stop offset='100%' stopColor='var(--theme-amber)' stopOpacity={1} />
      </linearGradient>
    </defs>
  )
}

interface MenuItemProps {
  href: string
  routePattern: string
  flipped?: boolean
  hotkey: HotkeyProp
  children: React.ReactNode
}

const AppBarMenuItem = React.forwardRef<HTMLAnchorElement, MenuItemProps>(
  ({ href, routePattern, flipped, hotkey, children }, ref) => {
    const [isActive] = useRoute(routePattern)
    const strokeLeftId = useId()
    const strokeRightId = useId()

    const [linkElem, setLinkElem] = useState<HTMLAnchorElement | null>(null)
    useButtonHotkey({ elem: linkElem, hotkey })

    return (
      <Link href={href} asChild={true}>
        <MenuItemRoot ref={setLinkElem} $isActive={isActive} draggable={false}>
          <MenuItemLeftEdge viewBox='0 0 20 64'>
            <polygon
              points={!flipped ? '0,0 20,0 20,64' : '0, 64, 20,64, 20,0'}
              fill='var(--menu-item-fill)'
            />
          </MenuItemLeftEdge>
          <MenuItemContent>{children}</MenuItemContent>
          <MenuItemRightEdge viewBox='0 0 20 64'>
            <polygon
              points={!flipped ? '0,0 20,64 0,64' : '0,64, 20,0, 0,0'}
              fill='var(--menu-item-fill)'
            />
          </MenuItemRightEdge>

          {isActive ? (
            <>
              {/*
                Draw outline in 3 pieces (with some overlap to prevent gaps) to allow it to
                stretch if needed
              */}
              <MenuItemLeftActiveStroke viewBox='0 0 24 64'>
                <MenuItemStrokeGradient id={strokeLeftId} />
                <path
                  d={
                    !flipped
                      ? 'M1.36,1 L20.735,63 L24,63 L20.735,63 Z'
                      : 'M20.735,1 L1.36,63 L24,63 L1.36,63 Z'
                  }
                  fill='none'
                  stroke={`url(#${strokeLeftId})`}
                  strokeWidth='2'
                />
              </MenuItemLeftActiveStroke>
              <MenuItemBottomActiveStroke />
              <MenuItemRightActiveStroke viewBox='0 0 24 64'>
                <MenuItemStrokeGradient id={strokeRightId} />
                <path
                  d={
                    !flipped
                      ? 'M3.265,1 L22.64,63 L0,63 L22.64,63 Z'
                      : 'M22.64,1 L3.265,63 L0,63 L3.265,63 Z'
                  }
                  fill='none'
                  stroke={`url(#${strokeRightId})`}
                  strokeWidth='2'
                />
              </MenuItemRightActiveStroke>
            </>
          ) : null}
        </MenuItemRoot>
      </Link>
    )
  },
)

const MenuItemsStart = styled.div`
  display: flex;
  justify-content: flex-end;

  & > ${MenuItemRoot} {
    margin-inline-start: -20px;
  }
`

const MenuItemsEnd = styled.div`
  display: flex;
  justify-content: flex-start;

  & > ${MenuItemRoot} {
    margin-inline-end: -20px;
  }
`

const PlayButtonRoot = styled.a`
  position: relative;
  width: 240px;
  height: 72px;
  margin: 0 -16px;
  padding-inline: 24px;
  z-index: 5;

  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible; /* Allow the shadow to exceed bounds */

  color: var(--theme-on-surface);
  font-size: 36px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  text-shadow: 1px 1px rgb(from var(--color-blue10) r g b / 50%);
  text-transform: uppercase;

  &:link,
  &:visited {
    color: var(--theme-on-surface);
  }

  @media (hover: hover) {
    &:hover {
      color: var(--theme-on-surface);
      text-decoration: none;
    }

    &:focus-visible {
      outline: none;

      &:after {
        content: '';
        position: absolute;
        top: 16px;
        left: 20px;
        right: 20px;
        bottom: 16px;
        outline: 2px solid var(--theme-amber);
        border-radius: 4px;
      }
    }
  }

  &:active {
    color: var(--theme-on-surface);
    text-decoration: none;
    --menu-item-fill: var(--color-grey-blue50);

    &:before {
      content: '';
      position: absolute;
      top: 0;
      left: 20px;
      right: 20px;
      bottom: 0;
      background: var(--menu-item-fill);
    }
  }

  @media (max-width: 600px) {
    /**
      NOTE(tec27): We assume no device this small will have the ability to play games anyway.
      This does make it hard to view the current lobby list but I think that's not a huge deal? If
      it is we can probably throw that into the navigation menu somehow.
    */
    display: none;
  }
`

const PlayButtonBackground = styled.svg`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;

  && {
    overflow: visible; /* Allow the shadow to exceed bounds */
  }
`

const PlayButtonContent = styled.div`
  contain: paint;
`

const LobbyPlayContent = styled(PlayButtonContent)`
  font-size: 28px;
  text-transform: none;

  white-space: normal;
`

const MatchLoadingPlayContent = styled(PlayButtonContent)`
  font-size: 24px;
  text-transform: none;
  white-space: normal;
`

const IngamePlayContent = styled(PlayButtonContent)`
  font-size: 24px;
  text-transform: none;
  white-space: normal;
`

const MatchmakingSearchPlayContent = styled(PlayButtonContent)`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;

  font-size: 24px;
  text-transform: none;
  white-space: normal;
`

const HoverOnly = styled.div`
  display: none;
`

const SearchInProgressContentRoot = styled(MatchmakingSearchPlayContent)`
  width: 100%;
  height: 100%;

  &:hover {
    & > ${HoverOnly} {
      display: block;
    }

    & > :not(${HoverOnly}) {
      display: none;
    }
  }
`

const StyledElapsedTime = styled(ElapsedTime)`
  ${titleSmall};
`

function SearchInProgressContent() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const matchmakingSearchInfo = useAppSelector(s => s.matchmaking.searchInfo)!

  const onClick = useStableCallback((event: MouseEvent) => {
    event.preventDefault()
    dispatch(cancelFindMatch())
  })

  return (
    <SearchInProgressContentRoot onClick={onClick}>
      <span>{matchmakingTypeToLabel(matchmakingSearchInfo.matchmakingType, t)}</span>
      <StyledElapsedTime startTimeMs={matchmakingSearchInfo.startTime} />
      <HoverOnly>{t('common.actions.cancel', 'Cancel')}</HoverOnly>
    </SearchInProgressContentRoot>
  )
}

function PlayButton() {
  const { t } = useTranslation()
  const gradientId = useId()
  const shadowId = useId()

  const isLobbyLoading = useAppSelector(s => s.lobby.info.isLoading)
  const lobbyName = useAppSelector(s => s.lobby.info.name)
  const isMatchLoading = useAppSelector(s => isMatchmakingLoading(s.matchmaking))
  const matchmakingType = useAppSelector(s => s.matchmaking.match?.type)
  const matchmakingLaunching = useAppSelector(s => s.matchmaking.isLaunching)
  const matchmakingCountingDown = useAppSelector(s => s.matchmaking.isCountingDown)
  const matchmakingStarting = useAppSelector(s => s.matchmaking.isStarting)

  const isInActiveGame = useAppSelector(s => s.activeGame.isActive)
  const gameInfo = useAppSelector(s => s.activeGame.info)

  const inLobby = useAppSelector(s => s.lobby.inLobby)
  const matchmakingSearchInfo = useAppSelector(s => s.matchmaking.searchInfo)
  const matchmakingMatch = useAppSelector(s => s.matchmaking.match)

  let targetPath = '/play/'
  let content = <PlayButtonContent>{t('navigation.bar.play', 'Play')}</PlayButtonContent>
  if (isLobbyLoading) {
    targetPath = urlPath`/lobbies/${lobbyName}/loading-game`
    content = (
      <LobbyPlayContent>{t('navigation.leftNav.customGame', 'Custom game')}</LobbyPlayContent>
    )
  } else if (isMatchLoading) {
    content = (
      <MatchLoadingPlayContent>
        {t('navigation.leftNav.rankedGame', {
          defaultValue: 'Ranked {{matchmakingType}}',
          matchmakingType: matchmakingType ? matchmakingTypeToLabel(matchmakingType, t) : '',
        })}
      </MatchLoadingPlayContent>
    )

    if (matchmakingLaunching) {
      targetPath = '/matchmaking/countdown'
    } else if (matchmakingCountingDown) {
      targetPath = '/matchmaking/countdown'
    } else if (matchmakingStarting) {
      targetPath = '/matchmaking/game-starting'
    } else {
      // This should never really happen but it makes TS happy
      targetPath = '/matchmaking/countdown'
    }
  } else if (isInActiveGame) {
    content = (
      <IngamePlayContent>{t('navigation.bar.playIngame', 'Game in progress')}</IngamePlayContent>
    )
    if (gameInfo?.type === 'lobby') {
      targetPath = urlPath`/lobbies/${gameInfo.extra.lobby.info.name}/active-game`
    } else if (gameInfo?.type === 'matchmaking') {
      targetPath = '/matchmaking/active-game'
    }
  } else if (inLobby) {
    targetPath = urlPath`/lobbies/${lobbyName}`
    content = (
      <LobbyPlayContent>{t('navigation.leftNav.customGame', 'Custom game')}</LobbyPlayContent>
    )
  } else if (matchmakingSearchInfo) {
    targetPath = '/play/matchmaking'
    if (matchmakingMatch) {
      content = (
        <MatchmakingSearchPlayContent>
          {t('matchmaking.navEntry.matchFound', 'Match found!')}
        </MatchmakingSearchPlayContent>
      )
    } else {
      content = <SearchInProgressContent />
    }
  }

  return (
    <Link href={targetPath} asChild={true}>
      <PlayButtonRoot draggable={false}>
        <PlayButtonBackground viewBox='0 0 240 72'>
          <defs>
            <linearGradient
              id={gradientId}
              x1='52'
              y1='-20'
              x2='188'
              y2='88'
              gradientUnits='userSpaceOnUse'>
              <stop stopColor='var(--color-blue70)' />
              <stop offset='0.418214' stopColor='var(--color-blue50)' />
              <stop offset='0.68' stopColor='var(--color-blue50)' />
              <stop offset='1' stopColor='var(--color-blue60)' />
            </linearGradient>
            {/*
            NOTE(tec27): This is a level 2 elevation shadow copied out of figma, we could probably
            simplify this a bunch
          */}
            <filter
              id={shadowId}
              x='-10'
              y='0'
              width='260'
              height='80'
              filterUnits='userSpaceOnUse'
              colorInterpolationFilters='sRGB'>
              <feFlood floodOpacity='0' result='BackgroundImageFix' />
              <feColorMatrix
                in='SourceAlpha'
                type='matrix'
                values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
                result='hardAlpha'
              />
              <feMorphology
                radius='2'
                operator='dilate'
                in='SourceAlpha'
                result='effect1_dropShadow_634_1625'
              />
              <feOffset dy='2' />
              <feGaussianBlur stdDeviation='3' />
              <feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.15 0' />
              <feBlend
                mode='normal'
                in2='BackgroundImageFix'
                result='effect1_dropShadow_634_1625'
              />
              <feColorMatrix
                in='SourceAlpha'
                type='matrix'
                values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
                result='hardAlpha'
              />
              <feOffset dy='1' />
              <feGaussianBlur stdDeviation='1' />
              <feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0' />
              <feBlend
                mode='normal'
                in2='effect1_dropShadow_634_1625'
                result='effect2_dropShadow_634_1625'
              />
              <feBlend
                mode='normal'
                in='SourceGraphic'
                in2='effect2_dropShadow_634_1625'
                result='shape'
              />
            </filter>
          </defs>
          <polygon
            points={`0,0 240,0 218,72 22,72`}
            fill={`url(#${gradientId})`}
            filter={`url(#${shadowId})`}
          />
          <path
            d={`
            M 239,0
            L 217,71
            L 23,71
            L 1,0
            L 23,71
            L 217,71
            Z
          `}
            fill='none'
            stroke='var(--color-blue90)'
            strokeWidth='2'
            strokeOpacity='0.4'
            strokeLinecap='square'
          />
        </PlayButtonBackground>
        {content}
      </PlayButtonRoot>
    </Link>
  )
}

const ShadowedIcon = styled(MaterialIcon)`
  text-shadow: 1px 1px rgb(from var(--color-grey-blue10) r g b / 50%);
`

const ShadowedToggleIcon = styled(ShadowedIcon)<{ $active?: boolean }>`
  ${props =>
    props.$active
      ? css`
          color: var(--theme-amber);
        `
      : css``};
  transition: color 250ms linear;
`

enum AppBarBreakpoint {
  Small,
  Normal,
}

const APP_BAR_BREAKPOINTS = [
  [0, AppBarBreakpoint.Small],
  [1320, AppBarBreakpoint.Normal],
] satisfies ReadonlyArray<[number, AppBarBreakpoint]>

const AppBarRoot = styled.div<{ $breakpoint: AppBarBreakpoint }>`
  grid-area: appbar;
  position: relative;

  height: 72px;
  margin-bottom: -8px;
  padding: 0 4px;

  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;

  color: var(--theme-on-surface-variant);

  &:before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 64px;
    background: var(--color-grey-blue30);
  }

  & > * {
    /** Give these elements a new stacking context so they display over top of the ::before */
    position: relative;
  }

  & > *:first-child {
    /*
      Push the left edge of content to be in the proper position without messing up the centering
      of the play button
    */
    margin-left: 12px;
  }
`

const AvatarSpace = styled.div`
  height: 64px;
  margin-bottom: 8px;

  display: flex;
  align-items: center;
`

const MenuItems = styled.div<{ $breakpoint: AppBarBreakpoint }>`
  ${sofiaSans};
  height: 100%;
  margin-bottom: 0px; /* Allow play button to stretch the whole parent */
  /* Need space for the diagonal edges of the outer menu items to draw */
  padding: 0 20px 0 calc(20px + var(--pixel-shove-x));

  display: grid;
  grid-template-columns: ${props =>
    props.$breakpoint === AppBarBreakpoint.Normal ? '1fr auto 1fr' : 'auto'};
  align-items: start;
`

const IconButtons = styled.div`
  margin-bottom: 8px;
  padding-right: 8px;

  display: flex;
  align-items: center;
  justify-content: flex-end;
`

const LeftSideSmall = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const AvatarButton = styled(IconButton)`
  width: 56px;
  height: 56px;
  margin: 4px;
`

function AppBar({
  onToggleSocial,
  sidebarOpen,
}: {
  onToggleSocial: () => void
  sidebarOpen: boolean
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const [breakpointRef, breakpoint] = useBreakpoint(APP_BAR_BREAKPOINTS, AppBarBreakpoint.Normal)
  const [onLoginPage] = useRoute('/login')
  const [appMenuOpen, onOpenAppMenu, onCloseAppMenu] = useNavigationMenuState('mainLayout.appMenu')
  const appMenuFocusable = useRef<HTMLAnchorElement>(null)

  const [profileOverlayOpen, openProfileOverlay, closeProfileOverlay] = usePopoverController()
  const [profileEntryElem, setProfileEntryElem] = useState<HTMLButtonElement | null>(null)

  const [settingsButton, setSettingsButton] = useState<HTMLButtonElement | null>(null)
  useButtonHotkey({ elem: settingsButton, hotkey: ALT_S })
  const [chatButton, setChatButton] = useState<HTMLButtonElement | null>(null)
  useButtonHotkey({ elem: chatButton, hotkey: ALT_H })

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (keyEventMatches(event, ALT_F)) {
        if (location.pathname !== '/play/matchmaking') {
          push('/play/matchmaking')
        }
        return true
      }
      if (keyEventMatches(event, ALT_B) || keyEventMatches(event, ALT_J)) {
        if (location.pathname !== '/play/lobbies') {
          push('/play/lobbies')
        }
        return true
      }
      if (IS_ELECTRON && keyEventMatches(event, ALT_C)) {
        if (location.pathname !== '/play/lobbies/create') {
          push('/play/lobbies/create')
        }
        return true
      }

      return false
    },
  })

  const avatarSpace = (
    <AvatarSpace>
      {selfUser ? (
        <>
          <AvatarButton
            ref={setProfileEntryElem}
            icon={<ConnectedAvatar userId={selfUser.id} />}
            testName='app-bar-user-button'
            ariaLabel={t('navigation.bar.userMenu', 'User menu')}
            onClick={openProfileOverlay}
          />
          <SelfProfileOverlay
            popoverProps={{
              open: profileOverlayOpen,
              onDismiss: closeProfileOverlay,
            }}
            anchor={profileEntryElem}
            username={selfUser?.name ?? ''}>
            <MenuItem
              icon={<MaterialIcon icon='account_box' />}
              text={t('navigation.leftNav.viewProfile', 'View profile')}
              onClick={() => {
                closeProfileOverlay()
                navigateToUserProfile(selfUser.id, selfUser.name)
              }}
            />
            {IS_ELECTRON ? (
              <MenuItem
                icon={<MaterialIcon icon='bug_report' />}
                text={t('navigation.leftNav.reportBug', 'Report a bug')}
                onClick={() => {
                  closeProfileOverlay()
                  dispatch(openDialog({ type: DialogType.BugReport }))
                }}
              />
            ) : undefined}
            <Divider />
            <MenuItem
              icon={<MaterialIcon icon='logout' />}
              text={t('navigation.leftNav.logOut', 'Log out')}
              onClick={() => {
                closeProfileOverlay()
                dispatch(
                  logOut({
                    onSuccess: () => {},
                    onError: err => {
                      logger.error(`Error logging out: ${getErrorStack(err)}`)
                      dispatch(
                        openSimpleDialog(
                          t('navigation.leftNav.logOutErrorTitle', 'Logging out failed'),
                          t(
                            'navigation.leftNav.logOutErrorMessage',
                            'Something went wrong. Please try again later.',
                          ),
                        ),
                      )
                    },
                  }),
                )
              }}
            />
          </SelfProfileOverlay>
        </>
      ) : (
        /* TODO(tec27): Use a filled button instead once implemented */
        <ElevatedButton
          label={t('auth.login.logIn', 'Log in')}
          testName='app-bar-login'
          onClick={() => {
            redirectToLogin(push)
          }}
          disabled={onLoginPage}
        />
      )}
    </AvatarSpace>
  )

  return (
    <>
      <AppBarRoot ref={breakpointRef} $breakpoint={breakpoint}>
        {breakpoint === AppBarBreakpoint.Normal ? (
          <>
            {avatarSpace}
            <MenuItems $breakpoint={breakpoint}>
              <MenuItemsStart>
                <AppBarMenuItem href='/' routePattern='/' hotkey={ALT_O}>
                  {t('navigation.bar.home', 'Home')}
                </AppBarMenuItem>
                <AppBarMenuItem href='/games/' routePattern='/games/*?' hotkey={ALT_G}>
                  {t('games.activity.title', 'Games')}
                </AppBarMenuItem>
                <AppBarMenuItem href='/replays/' routePattern='/replays/*?' hotkey={ALT_R}>
                  {t('replays.activity.title', 'Replays')}
                </AppBarMenuItem>
              </MenuItemsStart>
              <PlayButton />
              <MenuItemsEnd>
                <AppBarMenuItem href='/maps/' routePattern='/maps/*?' flipped={true} hotkey={ALT_M}>
                  {t('maps.activity.title', 'Maps')}
                </AppBarMenuItem>
                <AppBarMenuItem
                  href='/ladder/'
                  routePattern='/ladder/*?'
                  flipped={true}
                  hotkey={ALT_D}>
                  {t('ladder.activity.title', 'Ladder')}
                </AppBarMenuItem>
                <AppBarMenuItem
                  href='/leagues/'
                  routePattern='/leagues/*?'
                  flipped={true}
                  hotkey={ALT_A}>
                  {t('leagues.activity.title', 'Leagues')}
                </AppBarMenuItem>
              </MenuItemsEnd>
            </MenuItems>
          </>
        ) : (
          <>
            <LeftSideSmall>
              <IconButtons>
                <IconButton
                  icon={<ShadowedIcon icon='menu' />}
                  ariaLabel={t('navigation.bar.appMenu', 'Menu')}
                  testName='app-menu-button'
                  onClick={onOpenAppMenu}
                />
              </IconButtons>
              {avatarSpace}
            </LeftSideSmall>
            <MenuItems $breakpoint={breakpoint}>
              <PlayButton />
            </MenuItems>
          </>
        )}
        <IconButtons>
          <Tooltip
            text={t('settings.activity.title', 'Settings (Alt + S)')}
            position='bottom'
            tabIndex={-1}>
            <IconButton
              ref={setSettingsButton}
              icon={<ShadowedIcon icon='settings' />}
              onClick={() => dispatch(openSettings())}
              testName='settings-button'
            />
          </Tooltip>
          {selfUser ? (
            <>
              <NotificationsButton icon={<ShadowedIcon icon='notifications' />} />
              <Tooltip
                text={t('navigation.bar.social', 'Toggle social (ALT + H)')}
                position='bottom'
                tabIndex={-1}>
                <IconButton
                  ref={setChatButton}
                  icon={<ShadowedToggleIcon icon='chat' $active={sidebarOpen} />}
                  onClick={onToggleSocial}
                  testName='social-sidebar-button'
                />
              </Tooltip>
            </>
          ) : undefined}
        </IconButtons>
      </AppBarRoot>
      <NavigationMenuOverlay
        open={appMenuOpen}
        onClose={onCloseAppMenu}
        focusableRef={appMenuFocusable}>
        <NavigationMenuItem
          href='/'
          routePattern='/'
          icon={<MaterialIcon icon='home' />}
          text={t('navigation.bar.home', 'Home')}
          ref={appMenuFocusable}
        />
        <NavigationMenuItem
          href='/games/'
          routePattern='/games/*?'
          icon={<MaterialIcon icon='strategy' />}
          text={t('games.activity.title', 'Games')}
        />
        <NavigationMenuItem
          href='/replays/'
          routePattern='/replays/*?'
          icon={<MaterialIcon icon='movie' />}
          text={t('replays.activity.title', 'Replays')}
        />
        <NavigationMenuItem
          href='/maps/'
          routePattern='/maps/*?'
          icon={<MaterialIcon icon='map' />}
          text={t('maps.activity.title', 'Maps')}
        />
        <NavigationMenuItem
          href='/ladder/'
          routePattern='/ladder/*?'
          icon={<MaterialIcon icon='military_tech' />}
          text={t('ladder.activity.title', 'Ladder')}
        />
        <NavigationMenuItem
          href='/leagues/'
          routePattern='/leagues/*?'
          icon={<MaterialIcon icon='social_leaderboard' />}
          text={t('leagues.activity.title', 'Leagues')}
        />
      </NavigationMenuOverlay>
    </>
  )
}

const Content = styled.div`
  grid-area: content;
  overflow: auto;
`

const Sidebar = styled(SocialSidebar)`
  grid-area: sidebar;
  min-width: var(--sb-sidebar-width);
`

export function MainLayout({ children }: { children?: React.ReactNode }) {
  useLayoutEffect(() => {
    document.body.style.setProperty('--sb-app-bar-height', '64px')
    return () => {
      document.body.style.removeProperty('--sb-app-bar-height')
    }
  }, [])

  useShowEmailVerificationNotificationIfNeeded()
  useShowPolicyNotificationsIfNeeded()

  const isLoggedIn = useIsLoggedIn()
  const [sidebarOpen, setSidebarOpen] = useUserLocalStorageValue('socialSidebarOpen', isLoggedIn)
  // TODO(tec27): Place focus inside the social sidebar when it opens (maybe pick the spot to focus
  // [e.g. channels or whispers] based on how it got opened?)
  const onToggleSocial = useStableCallback(() => setSidebarOpen(!sidebarOpen))
  const onShowSocial = useStableCallback(() => setSidebarOpen(true))

  return (
    <Root $sidebarOpen={sidebarOpen}>
      <AppBar onToggleSocial={onToggleSocial} sidebarOpen={sidebarOpen} />
      <Content>{children}</Content>
      {isLoggedIn ? <Sidebar onShowSidebar={onShowSocial} /> : <div></div>}
      <NotificationPopups />
    </Root>
  )
}
