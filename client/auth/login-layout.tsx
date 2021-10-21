import React, { useLayoutEffect } from 'react'
import styled from 'styled-components'
import { SizeLeft, SizeRight, SizeTop } from '../app-bar/window-controls'
import { ConnectedDialogOverlay } from '../dialogs/connected-dialog-overlay'
import LogoText from '../logos/logotext-640x100.svg'
import { makeServerUrl } from '../network/server-url'
import { blue800 } from '../styles/colors'

const Background = styled.div`
  .electron & {
    overflow: hidden;
  }
`

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  padding-left: var(--pixel-shove-x, 0);

  .electron & {
    height: calc(100% - 32px);
    overflow: auto;
  }
`

const DRAGGABLE_HEIGHT = '32px'

const Draggable = styled.div`
  width: 100%;
  height: ${DRAGGABLE_HEIGHT};

  .electron & {
    background-color: ${blue800};
    -webkit-app-region: drag;
  }
`

const Contents = styled.div`
  width: calc(640px + (16px * 2));
  margin: 0 auto;
`

const Logo = styled.img`
  width: 192px;
  height: 192px;
  display: block;
  margin: 0 auto;
`

const StyledLogoText = styled.div`
  display: block;
  margin: 0 auto 8px;
  text-align: center;
`

export interface LoginLayoutProps {
  children: React.ReactNode
}

export default function LoginLayout({ children }: LoginLayoutProps) {
  useLayoutEffect(() => {
    document.body.style.setProperty(
      '--sb-system-bar-height',
      IS_ELECTRON ? DRAGGABLE_HEIGHT : '0px',
    )
    return () => {
      document.body.style.removeProperty('--sb-system-bar-height')
    }
  }, [])

  return (
    <Background>
      <Draggable>
        <SizeTop />
        <SizeLeft />
        <SizeRight />
      </Draggable>
      <Wrapper>
        <Contents>
          <Logo src={makeServerUrl('/images/logo.svg')} />
          <StyledLogoText>
            <LogoText />
          </StyledLogoText>
          {children}
        </Contents>
      </Wrapper>
      <ConnectedDialogOverlay />
    </Background>
  )
}
