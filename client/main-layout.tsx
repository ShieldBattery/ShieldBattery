import keycode from 'keycode'
import * as m from 'motion/react-m'
import React, { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { Link, useRoute } from 'wouter'
import { getErrorStack } from '../common/errors'
import { SbUser } from '../common/users/sb-user'
import { logOut } from './auth/action-creators'
import { redirectToLogin, useIsLoggedIn, useSelfUser } from './auth/auth-utils'
import { ConnectedAvatar } from './avatars/avatar'
import { openDialog, openSimpleDialog } from './dialogs/action-creators'
import { DialogType } from './dialogs/dialog-type'
import { useBreakpoint } from './dom/dimension-hooks'
import { useOverflowingElement } from './dom/overflowing-element'
import { PlayButton } from './gameplay-activity/play-button'
import { useHasNewUrgentMessage } from './home/last-seen-urgent-message'
import { MaterialIcon } from './icons/material/material-icon'
import { useKeyListener } from './keyboard/key-listener'
import logger from './logging/logger'
import {
  FilledButton,
  HotkeyProp,
  IconButton,
  keyEventMatches,
  useButtonHotkey,
  useButtonState,
} from './material/button'
import { buttonReset } from './material/button-reset'
import { emphasizedAccelerateEasing, emphasizedDecelerateEasing } from './material/curve-constants'
import { Divider } from './material/menu/divider'
import { MenuItem } from './material/menu/item'
import { usePopoverController } from './material/popover'
import { Ripple } from './material/ripple'
import { elevationPlus1 } from './material/shadows'
import { Tooltip } from './material/tooltip'
import {
  NavigationMenuItem,
  NavigationMenuOverlay,
  useNavigationMenuState,
} from './navigation/navigation-menu'
import { push } from './navigation/routing'
import { NotificationsButton } from './notifications/app-bar-entry'
import NotificationPopups from './notifications/notifications-popup'
import { useShowPolicyNotificationsIfNeeded } from './policies/show-notifications'
import { LoadingDotsArea } from './progress/dots'
import { useMultiplexRef } from './react/refs'
import { useUserLocalStorageValue } from './react/state-hooks'
import { useAppDispatch } from './redux-hooks'
import { openSettings } from './settings/action-creators'
import { CAN_PIN_WIDTH, SocialSidebar } from './social/social-sidebar'
import { singleLine, sofiaSans, titleMedium, TitleTiny } from './styles/typography'
import { navigateToUserProfile } from './users/action-creators'
import { SelfProfileOverlay } from './users/self-profile-overlay'

const ALT_A = { keyCode: keycode('a'), altKey: true }
const ALT_B = { keyCode: keycode('b'), altKey: true }
const ALT_C = { keyCode: keycode('c'), altKey: true }
const ALT_D = { keyCode: keycode('d'), altKey: true }
const ALT_F = { keyCode: keycode('f'), altKey: true }
const ALT_G = { keyCode: keycode('g'), altKey: true }
const ALT_J = { keyCode: keycode('j'), altKey: true }
const ALT_M = { keyCode: keycode('m'), altKey: true }
const ALT_O = { keyCode: keycode('o'), altKey: true }
const ALT_R = { keyCode: keycode('r'), altKey: true }
const ALT_S = { keyCode: keycode('s'), altKey: true }

const SIDEBAR_WIDTH = 320

if (__WEBPACK_ENV.NODE_ENV !== 'production' && CAN_PIN_WIDTH >= SIDEBAR_WIDTH + 1248) {
  throw new Error('CAN_PIN_WIDTH must be less than SIDEBAR_WIDTH + 1248 or styles need adjusting')
}

const Root = styled.div<{ $sidebarOpen?: boolean; $sidebarPinned?: boolean }>`
  width: 100%;
  height: calc(100% - var(--sb-system-bar-height, 0px));
  overflow: hidden;

  --sb-sidebar-width: ${SIDEBAR_WIDTH}px;

  display: grid;
  grid-template-columns: 0 minmax(auto, 1fr) 0;
  grid-template-areas:
    'appbar appbar appbar'
    'padding content sidebar';
  grid-template-rows: auto 1fr;

  --_cur-sidebar-column-size: ${props =>
    props.$sidebarOpen && props.$sidebarPinned ? 'var(--sb-sidebar-width)' : '0'};
  --_cur-sidebar-adjustment-size: ${props =>
    props.$sidebarOpen && props.$sidebarPinned
      ? 'calc(100dvw - 1248px - var(--sb-sidebar-width))'
      : '0'};

  @media (min-width: ${CAN_PIN_WIDTH}px) {
    grid-template-columns: 0 minmax(auto, 1fr) var(--_cur-sidebar-column-size);
    transition: ${props => {
      const open = props.$sidebarOpen
      return `grid-template-columns ${open ? '400ms' : '200ms'} ${
        open ? emphasizedDecelerateEasing : emphasizedAccelerateEasing
      }`
    }};
  }

  @media (min-width: ${SIDEBAR_WIDTH + 1248}px) {
    grid-template-columns:
      var(--_cur-sidebar-adjustment-size)
      minmax(auto, 1fr)
      var(--_cur-sidebar-column-size);
  }

  @media (min-width: ${SIDEBAR_WIDTH * 2 + 1248}px) {
    grid-template-columns:
      var(--_cur-sidebar-column-size)
      minmax(auto, 1fr)
      var(--_cur-sidebar-column-size);
  }
`

const MenuItemRoot = styled.a<{ $isActive?: boolean }>`
  ${singleLine};

  position: relative;
  min-width: 128px;
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
        top: 12px;
        left: 16px;
        right: 16px;
        bottom: 14px;
        outline: 3px solid var(--theme-amber);
        outline-offset: 2px;
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

const MenuItemPip = styled.div`
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: 6px;
  width: 8px;
  height: 8px;
  background-color: var(--theme-amber);
  border-radius: 50%;
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
  showPip?: boolean
  children: React.ReactNode
  ref?: React.Ref<HTMLAnchorElement>
}

function AppBarMenuItem({
  href,
  routePattern,
  flipped,
  hotkey,
  showPip,
  children,
  ref,
}: MenuItemProps) {
  const [isActive] = useRoute(routePattern)
  const strokeLeftId = useId()
  const strokeRightId = useId()

  const [linkElem, setLinkElem] = useState<HTMLAnchorElement | null>(null)
  const combinedRef = useMultiplexRef(setLinkElem, ref)
  useButtonHotkey({ elem: linkElem, hotkey })

  return (
    <Link href={href} asChild={true}>
      <MenuItemRoot ref={combinedRef} $isActive={isActive} draggable={false}>
        <MenuItemLeftEdge viewBox='0 0 20 64'>
          <polygon
            points={!flipped ? '0,0 20,0 20,64' : '0, 64, 20,64, 20,0'}
            fill='var(--menu-item-fill)'
          />
        </MenuItemLeftEdge>
        <MenuItemContent>
          {children}
          {showPip && <MenuItemPip />}
        </MenuItemContent>
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
}

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

  width: 100%;
  height: 72px;
  margin-bottom: -8px;
  padding: 0 4px;
  z-index: 5;

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

const LeftSide = styled.div`
  display: grid;
  grid-template-columns: [menu-button] auto [user-button] 1fr;

  align-items: center;
`

const NavigationMenuButton = styled(IconButton)`
  margin-inline: 12px 8px;
`

const UserSpace = styled.div`
  grid-column: user-button;

  height: 64px;
  min-width: min(200px, 100% - 12px);
  max-width: 100%;
  margin-bottom: 8px;
  flex-shrink: 1;
  overflow: visible;

  display: flex;
  align-items: center;

  &:first-child {
    margin-left: 2px;
  }
`

const UserButton = styled.button`
  ${buttonReset};
  ${elevationPlus1};

  height: 52px;
  min-width: min(160px, 100% - 16px);
  width: fit-content;
  max-width: calc(100% - 16px);
  margin-inline: 0 16px;
  margin-block: 6px;
  padding-inline: 8px 12px;
  overflow: hidden;

  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;

  background-color: var(--theme-primary-container);
  border-radius: 8px;
  color: var(--theme-on-primary-container);

  @media (max-width: 704px) {
    width: 56px;
    min-width: unset;
    max-width: unset;
  }
`

const UserButtonAvatar = styled(ConnectedAvatar)`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
`

const UserButtonNameAndTitle = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  overflow: hidden;
  flex-grow: 1;
  flex-shrink: 1;

  & > * {
    ${singleLine};
    max-width: 100%;
    overflow: hidden;
  }

  @media (max-width: 704px) {
    display: none;
  }
`

const UserButtonName = styled.div`
  ${titleMedium};
  ${singleLine};
  max-width: 100%;
`

const LogInButton = styled(FilledButton)`
  margin-left: 4px;
  :first-child > & {
    margin-left: 20px;
  }
`

function AppBarUser({
  user,
  onClick,
  ref,
}: {
  user: SbUser
  onClick: (event: React.MouseEvent) => void
  ref?: React.Ref<HTMLButtonElement>
}) {
  const { t } = useTranslation()
  const [buttonProps, rippleRef] = useButtonState({ onClick })

  const [nameRef, isNameOverflowing] = useOverflowingElement<HTMLDivElement>()

  const title = t('users.titles.novice', 'Novice')

  return (
    <UserButton
      {...buttonProps}
      ref={ref}
      data-test='app-bar-user-button'
      aria-label={t('navigation.bar.userMenu', 'User menu')}>
      <UserButtonAvatar userId={user.id} />
      <UserButtonNameAndTitle>
        <Tooltip
          text={user.name}
          position='bottom'
          disabled={!isNameOverflowing}
          tabIndex={isNameOverflowing ? 0 : -1}>
          <UserButtonName ref={nameRef}>{user.name}</UserButtonName>
        </Tooltip>
        <TitleTiny>{title}</TitleTiny>
      </UserButtonNameAndTitle>
      <Ripple ref={rippleRef} />
    </UserButton>
  )
}

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

  const homeHasPip = useHasNewUrgentMessage()

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

  const userSpace = (
    <UserSpace>
      {selfUser ? (
        <>
          <AppBarUser ref={setProfileEntryElem} onClick={openProfileOverlay} user={selfUser} />
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
        <LogInButton
          label={t('auth.login.logIn', 'Log in')}
          testName='app-bar-login'
          onClick={() => {
            redirectToLogin(push)
          }}
          disabled={onLoginPage}
        />
      )}
    </UserSpace>
  )

  return (
    <>
      <AppBarRoot ref={breakpointRef} $breakpoint={breakpoint}>
        {breakpoint === AppBarBreakpoint.Normal ? (
          <>
            <LeftSide>{userSpace}</LeftSide>
            <MenuItems $breakpoint={breakpoint}>
              <MenuItemsStart>
                <AppBarMenuItem href='/' routePattern='/' hotkey={ALT_O} showPip={homeHasPip}>
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
            <LeftSide>
              <IconButtons>
                <NavigationMenuButton
                  icon={<ShadowedIcon icon='menu' />}
                  ariaLabel={t('navigation.bar.appMenu', 'Menu')}
                  testName='app-menu-button'
                  onClick={onOpenAppMenu}
                />
              </IconButtons>
              {userSpace}
            </LeftSide>
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
          showPip={homeHasPip}
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

export const MainLayoutContent = styled(m.div)`
  grid-area: content;
  overflow: auto;
`

export const MainLayoutLoadingDotsArea = styled(LoadingDotsArea)`
  grid-area: content;
`

export function MainLayout({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    document.body.style.setProperty('--sb-app-bar-height', '64px')
    return () => {
      document.body.style.removeProperty('--sb-app-bar-height')
    }
  }, [])

  useShowPolicyNotificationsIfNeeded()

  const isLoggedIn = useIsLoggedIn()
  const [sidebarOpen, setSidebarOpen] = useUserLocalStorageValue('socialSidebarOpen', isLoggedIn)
  const [sidebarPinned, setSidebarPinned] = useUserLocalStorageValue('socialSidebarPinned', true)

  return (
    <Root $sidebarOpen={sidebarOpen} $sidebarPinned={sidebarPinned}>
      <AppBar onToggleSocial={() => setSidebarOpen(!sidebarOpen)} sidebarOpen={sidebarOpen} />
      {children}
      {isLoggedIn ? (
        <SocialSidebar
          onVisibilityChange={setSidebarOpen}
          visible={sidebarOpen}
          onPinnedChange={setSidebarPinned}
          pinned={sidebarPinned}
        />
      ) : (
        <div></div>
      )}
      <NotificationPopups />
    </Root>
  )
}
