import keycode from 'keycode'
import React, { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { Link, useRoute } from 'wouter'
import { logOut } from './auth/action-creators'
import { redirectToLogin, useIsLoggedIn, useSelfUser } from './auth/auth-utils'
import { ConnectedAvatar } from './avatars/avatar'
import { openChangelog } from './changelog/action-creators'
import { openDialog } from './dialogs/action-creators'
import { DialogType } from './dialogs/dialog-type'
import { useBreakpoint } from './dom/dimension-hooks'
import { MaterialIcon } from './icons/material/material-icon'
import { useKeyListener } from './keyboard/key-listener'
import {
  HotkeyProp,
  IconButton,
  keyEventMatches,
  RaisedButton,
  useButtonHotkey,
} from './material/button'
import { emphasizedAccelerateEasing, emphasizedDecelerateEasing } from './material/curve-constants'
import { Divider } from './material/menu/divider'
import { MenuItem } from './material/menu/item'
import { usePopoverController } from './material/popover'
import { Tooltip } from './material/tooltip'
import { push } from './navigation/routing'
import { NotificationsButton } from './notifications/activity-bar-entry'
import NotificationPopups from './notifications/notifications-popup'
import { useAppDispatch } from './redux-hooks'
import { openSettings } from './settings/action-creators'
import { SocialSidebar } from './social/social-sidebar'
import { useMultiRef, useStableCallback, useUserLocalStorageValue } from './state-hooks'
import { singleLine, sofiaSans } from './styles/typography'
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
  /* Note: width/height come from global styles */

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
      ${props => (props.$sidebarOpen ? 'calc(100vw - 1248px - var(--sb-sidebar-width))' : '0')}
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
  text-shadow: 1px 1px rgba(0, 0, 0, 0.24);
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
    --menu-item-fill: var(--color-grey-blue60);

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

    const [linkRef, setLinkRef] = useMultiRef(ref)
    useButtonHotkey({ ref: linkRef, hotkey })

    return (
      <Link href={href} asChild={true}>
        <MenuItemRoot ref={setLinkRef} $isActive={isActive}>
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
  ${singleLine};

  position: relative;
  width: 240px;
  height: 72px;
  margin: 0 -16px;
  z-index: 5;

  display: block;
  overflow: visible; /* Allow the shadow to exceed bounds */

  color: var(--theme-on-surface);
  font-size: 36px;
  font-weight: 700;
  line-height: 72px;
  text-align: center;
  text-shadow: 1px 1px rgba(0, 0, 0, 0.24);
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
    --menu-item-fill: var(--color-grey-blue60);

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

function PlayButton({ children }: { children?: React.ReactNode }) {
  const gradientId = useId()
  const shadowId = useId()

  // FIXME: destination + content should be based on the user's current gameplay activity
  return (
    <Link href='/play/' asChild={true}>
      <PlayButtonRoot>
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
        <PlayButtonContent>{children}</PlayButtonContent>
      </PlayButtonRoot>
    </Link>
  )
}

const ShadowedIcon = styled(MaterialIcon)`
  text-shadow: 1px 1px rgba(0, 0, 0, 0.24);
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
  padding: 0 4px 0 12px;

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
    background: var(--color-grey-blue40);
  }

  & > * {
    /** Give these elements a new stacking context so they display over top of the ::before */
    position: relative;
  }
`

const AvatarSpace = styled.div`
  width: 64px;
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

  const [profileOverlayOpen, openProfileOverlay, closeProfileOverlay] = usePopoverController()
  const profileEntryRef = useRef<HTMLButtonElement>(null)

  const onLogIn = useStableCallback(() => {
    redirectToLogin(push)
  })
  const onLogOutClick = useStableCallback(() => {
    closeProfileOverlay()
    dispatch(logOut().action)
  })
  const onChangelogClick = useStableCallback(() => {
    closeProfileOverlay()
    dispatch(openChangelog())
  })
  const onViewProfileClick = useStableCallback(() => {
    closeProfileOverlay()
    navigateToUserProfile(selfUser!.id, selfUser!.name)
  })
  const onReportBugClick = useStableCallback(() => {
    closeProfileOverlay()
    dispatch(openDialog({ type: DialogType.BugReport }))
  })

  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  useButtonHotkey({ ref: settingsButtonRef, hotkey: ALT_S })
  const chatButtonRef = useRef<HTMLButtonElement>(null)
  useButtonHotkey({ ref: chatButtonRef, hotkey: ALT_H })

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
        <AvatarButton
          ref={profileEntryRef}
          icon={<ConnectedAvatar userId={selfUser.id} />}
          testName='app-bar-user-button'
          ariaLabel={t('navigation.bar.userMenu', 'User menu')}
          onClick={openProfileOverlay}
        />
      ) : (
        /* TODO(tec27): Use a filled button instead once implemented */
        <RaisedButton
          label={t('auth.login.logIn', 'Log in')}
          testName='app-bar-login'
          onClick={onLogIn}
          disabled={onLoginPage}
        />
      )}
    </AvatarSpace>
  )
  const playButton = <PlayButton>{t('navigation.bar.play', 'Play')}</PlayButton>

  // FIXME: build app menu for small screens
  return (
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
            {playButton}
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
              />
            </IconButtons>
            {avatarSpace}
          </LeftSideSmall>
          <MenuItems $breakpoint={breakpoint}>{playButton}</MenuItems>
        </>
      )}
      <IconButtons>
        <Tooltip
          text={t('settings.activity.title', 'Settings (Alt + S)')}
          position='bottom'
          tabIndex={-1}>
          <IconButton
            ref={settingsButtonRef}
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
                ref={chatButtonRef}
                icon={<ShadowedToggleIcon icon='chat' $active={sidebarOpen} />}
                onClick={onToggleSocial}
                testName='social-sidebar-button'
              />
            </Tooltip>
          </>
        ) : undefined}
      </IconButtons>
      <SelfProfileOverlay
        popoverProps={{
          open: profileOverlayOpen,
          onDismiss: closeProfileOverlay,
        }}
        anchor={profileEntryRef.current}
        username={selfUser?.name ?? ''}>
        <MenuItem
          icon={<MaterialIcon icon='account_box' />}
          text={t('navigation.leftNav.viewProfile', 'View profile')}
          onClick={onViewProfileClick}
        />
        <MenuItem
          icon={<MaterialIcon icon='new_releases' />}
          text={t('navigation.leftNav.viewChangelog', 'View changelog')}
          onClick={onChangelogClick}
        />
        {IS_ELECTRON ? (
          <MenuItem
            icon={<MaterialIcon icon='bug_report' />}
            text={t('navigation.leftNav.reportBug', 'Report a bug')}
            onClick={onReportBugClick}
          />
        ) : undefined}
        <Divider />
        <MenuItem
          icon={<MaterialIcon icon='logout' />}
          text={t('navigation.leftNav.logOut', 'Log out')}
          onClick={onLogOutClick}
        />
      </SelfProfileOverlay>
    </AppBarRoot>
  )
}

const Content = styled.div`
  grid-area: content;

  display: flex;
  flex-direction: column;
  align-items: center;

  overflow: auto;
`

const Sidebar = styled(SocialSidebar)`
  grid-area: sidebar;
  min-width: var(--sb-sidebar-width);
`

export function MainLayout({ children }: { children?: React.ReactNode }) {
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
