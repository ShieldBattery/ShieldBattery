import React, { useCallback, useLayoutEffect } from 'react'
import styled from 'styled-components'
import { DEV_INDICATOR } from '../../common/flags'
import { useIsAdmin } from '../admin/admin-permissions'
import { MaterialIcon } from '../icons/material/material-icon'
import Lockup from '../logos/lockup-system-bar-24px.svg'
import { IconButton } from '../material/button'
import { zIndexAppBar } from '../material/zindex'
import { push } from '../navigation/routing'
import { labelLarge, labelMedium } from '../styles/typography'
import { SizeLeft, SizeRight, SizeTop } from './window-controls'

const Container = styled.header`
  flex-grow: 0;
  flex-shrink: 0;

  width: 100%;
  height: 32px;
  margin: 0;
  padding: 0;
  position: relative;

  display: flex;
  flex-direction: row;

  background-color: var(--color-grey-blue20);
  overflow: hidden;
  z-index: ${zIndexAppBar};

  -webkit-app-region: drag;
`

const LeftSide = styled.div`
  height: 100%;
  padding: 0 2px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const StyledIconButton = styled(IconButton)`
  width: 48px;
  min-height: 24px;
  padding: 0;
  -webkit-app-region: no-drag;
`

const DevIndicator = styled.div`
  ${labelLarge};

  width: 72px;
  height: 20px;
  margin-left: 8px;
  padding-block: 2px;

  background-color: var(--theme-amber);
  color: var(--theme-on-amber);
  font-variation-settings: 'wght' 600;

  border-radius: 2px;
  cursor: pointer;
  line-height: 16px;
  text-align: center;
  text-transform: uppercase;
  -webkit-app-region: no-drag;
`

const StyledLockup = styled(Lockup)`
  width: auto;
  height: 24px;
  flex-grow: 0;
  flex-shrink: 0;
`

const VersionTextRoot = styled.div`
  ${labelMedium};

  color: var(--theme-on-surface-variant);
  letter-spacing: 1.25px;
  line-height: 1;
`

const CUR_VERSION = __WEBPACK_ENV.VERSION

export function VersionText() {
  return <VersionTextRoot>v{CUR_VERSION}</VersionTextRoot>
}

export function SystemBar() {
  useLayoutEffect(() => {
    document.body.style.setProperty('--sb-system-bar-height', '32px')
    return () => {
      document.body.style.removeProperty('--sb-system-bar-height')
    }
  }, [])
  const isAdmin = useIsAdmin()
  const onAdminClick = useCallback(() => {
    push('/admin')
  }, [])

  return (
    <Container>
      <SizeTop />
      <SizeLeft />
      <SizeRight />
      <LeftSide>
        <StyledLockup />
        <VersionText />
        {DEV_INDICATOR ? (
          // TODO(tec27): Find a place for this + admin that will show up on the web version too
          <DevIndicator title='Go to dev pages' onClick={() => push('/dev')}>
            Dev
          </DevIndicator>
        ) : null}
        {isAdmin ? (
          <StyledIconButton
            title='Admin'
            icon={<MaterialIcon icon='admin_panel_settings' size={20} filled={false} />}
            onClick={onAdminClick}
          />
        ) : null}
      </LeftSide>
    </Container>
  )
}
