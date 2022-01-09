import React from 'react'
import styled from 'styled-components'
import LogoText from '../logos/logotext-640x100.svg'
import { makeServerUrl } from '../network/server-url'

const Wrapper = styled.div`
  width: 100%;
  padding-left: var(--pixel-shove-x, 0);
  overflow: auto;
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
  return (
    <Wrapper>
      <Contents>
        <Logo src={makeServerUrl('/images/logo.svg')} />
        <StyledLogoText>
          <LogoText />
        </StyledLogoText>
        {children}
      </Contents>
    </Wrapper>
  )
}
