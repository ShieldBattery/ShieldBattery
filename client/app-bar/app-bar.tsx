import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { DEV_INDICATOR } from '../../common/flags'
import { useIsAdmin } from '../admin/admin-permissions'
import DiscordIcon from '../icons/brands/discord.svg'
import GitHubIcon from '../icons/brands/github.svg'
import KofiColorIcon from '../icons/brands/kofi-color.svg'
import PatreonIcon from '../icons/brands/patreon.svg'
import TwitterIcon from '../icons/brands/twitter.svg'
import AdminIcon from '../icons/material/admin_panel_settings_black_24px.svg'
import IconButton from '../material/icon-button'
import Divider from '../material/menu/divider'
import MenuItem from '../material/menu/item'
import Menu from '../material/menu/menu'
import { shadow4dp } from '../material/shadows'
import { standardIncrement } from '../material/units'
import { zIndexAppBar } from '../material/zindex'
import { push } from '../navigation/routing'
import { ActiveUserCount } from '../serverstatus/active-users'
import { blue800, colorError, colorTextSecondary } from '../styles/colors'
import { body1, caption, headline6, overline, singleLine } from '../styles/typography'
import Lockup from './lockup'
import { SizeLeft, SizeRight, SizeTop, windowControlsHeight } from './window-controls'

const Container = styled.header`
  ${shadow4dp};
  width: 100%;
  height: ${standardIncrement};
  margin: 0;
  padding: 0;
  position: relative;

  display: flex;
  flex-direction: row;
  background-color: ${blue800};
  overflow: hidden;
  z-index: ${zIndexAppBar};

  -webkit-app-region: drag;
`

const LeftSide = styled.div`
  width: 264px;
  position: relative;
`

const AppMenu = styled(Menu)`
  width: 224px;
  max-height: 420px;
`

const AppMenuOverline = styled.div`
  ${overline};
  ${singleLine};
  color: ${colorTextSecondary};
  padding: 8px 12px 0;
`

const Content = styled.div`
  height: 100%;
  flex-grow: 1;

  display: flex;
  align-items: center;

  & > * {
    padding-left: 16px;
  }
`

export const AppBarTitle = styled.div`
  ${headline6};
  ${singleLine};
`

const RightSide = styled.div`
  width: 144px;
  height: calc(${standardIncrement} - ${windowControlsHeight});
  margin-top: ${windowControlsHeight};

  display: flex;
  align-items: center;
`

const UserCount = styled(ActiveUserCount)`
  ${body1};
  ${singleLine};

  flex-shrink: 0;
  flex-grow: 1;
  padding-right: 16px;
  text-align: right;
`

const StyledIconButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  padding: 0;
  // NOTE(tec27): This icon is a bit weird and feels off-center when centered
  margin-left: 10px;
  -webkit-app-region: no-drag;
`

const DevIndicator = styled.div`
  ${caption};

  width: 100px;
  height: 20px;
  position: absolute;
  top: 8px;
  left: -32px;

  background-color: ${colorError};
  cursor: pointer;
  font-weight: 600;
  letter-spacing: 2px;
  line-height: 20px;
  opacity: 0.84;
  text-align: center;
  text-transform: uppercase;
  transform: rotate(-45deg);
  -webkit-app-region: no-drag;
`

const StyledTwitterIcon = styled(TwitterIcon)`
  color: #1d9bf0;
`

const StyledPatreonIcon = styled(PatreonIcon)`
  color: #ff424e;
`

export interface AppBarProps {
  children?: React.ReactNode
  className?: string
}

const APP_MENU_LINKS = [
  ['Discord', <DiscordIcon />, 'https://discord.gg/S8dfMx94a4'],
  ['Twitter', <StyledTwitterIcon />, 'https://twitter.com/ShieldBatteryBW'],
  ['GitHub', <GitHubIcon />, 'https://github.com/ShieldBattery/ShieldBattery'],
  [],
  ['Support the project'],
  ['Patreon', <StyledPatreonIcon />, 'https://patreon.com/tec27'],
  ['GitHub Sponsors', <GitHubIcon />, 'https://github.com/sponsors/ShieldBattery'],
  ['Ko-fi', <KofiColorIcon />, 'https://ko-fi.com/tec27'],
]

export default function AppBar(props: AppBarProps) {
  useLayoutEffect(() => {
    document.body.style.setProperty('--sb-system-bar-height', standardIncrement)
    return () => {
      document.body.style.removeProperty('--sb-system-bar-height')
    }
  }, [])
  const isAdmin = useIsAdmin()
  const onAdminClick = useCallback(() => {
    push('/admin')
  }, [])

  const [appMenuAnchor, setAppMenuAnchor] = useState<Element | null>(null)
  const onLockupClick = useCallback((event: React.MouseEvent) => {
    setAppMenuAnchor(event.currentTarget as Element)
  }, [])
  const onAppMenuDismiss = useCallback(() => {
    setAppMenuAnchor(null)
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
                setAppMenuAnchor(null)
              }}
            />
          )
        } else if (text) {
          return <AppMenuOverline key={i}>{text}</AppMenuOverline>
        } else {
          return <Divider key={i} />
        }
      }),
    [APP_MENU_LINKS],
  )

  // TODO(tec27): Make menus (popovers?) support vertical-only transition, or at least grow
  // from middle
  return (
    <Container className={props.className}>
      <SizeTop />
      <SizeLeft />
      <SizeRight />
      <LeftSide>
        <Lockup
          onClick={appMenuAnchor ? onAppMenuDismiss : onLockupClick}
          menuOpened={!!appMenuAnchor}
        />
        <AppMenu
          open={!!appMenuAnchor}
          onDismiss={onAppMenuDismiss}
          anchor={appMenuAnchor}
          anchorOriginVertical='bottom'
          anchorOriginHorizontal='left'
          popoverOriginVertical='top'
          popoverOriginHorizontal='left'
          anchorOffsetHorizontal={16}
          anchorOffsetVertical={-8}>
          {appMenuItems}
        </AppMenu>
        {DEV_INDICATOR ? <DevIndicator onClick={() => push('/dev')}>Dev</DevIndicator> : null}
      </LeftSide>
      <Content>{props.children}</Content>
      <RightSide>
        {isAdmin ? (
          <StyledIconButton title='Admin' icon={<AdminIcon />} onClick={onAdminClick} />
        ) : null}
        <UserCount />
      </RightSide>
    </Container>
  )
}
