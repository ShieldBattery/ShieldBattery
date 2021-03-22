import React, { useCallback, useLayoutEffect } from 'react'
import styled from 'styled-components'
import { DEV_INDICATOR } from '../../common/flags'
import { useIsAdmin } from '../admin/admin-permissions'
import AdminIcon from '../icons/material/admin_panel_settings_black_24px.svg'
import IconButton from '../material/icon-button'
import { shadow4dp } from '../material/shadows'
import { standardIncrement } from '../material/units'
import { zIndexAppBar } from '../material/zindex'
import { push } from '../navigation/routing'
import { ActiveUserCount } from '../serverstatus/active-users'
import { blue800, colorError } from '../styles/colors'
import { body1, caption, headline6, singleLine } from '../styles/typography'
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
  width: 240px;
  position: relative;
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

export interface AppBarProps {
  children?: React.ReactNode
  className?: string
}

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

  return (
    <Container className={props.className}>
      <SizeTop />
      <SizeLeft />
      <SizeRight />
      <LeftSide>
        <Lockup />
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
