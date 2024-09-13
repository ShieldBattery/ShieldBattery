import React from 'react'
import { styled } from 'styled-components'
import { TopLinks } from '../landing/top-links.js'
import LogoText from '../logos/logotext-640x100.svg'
import { makePublicAssetUrl } from '../network/server-url.js'

const Wrapper = styled.div`
  width: 100%;
  padding-left: var(--pixel-shove-x, 0);
  overflow: auto;
`

const StyledTopLinks = styled(TopLinks)`
  margin: 8px auto;
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
      <StyledTopLinks />
      <Contents>
        <Logo src={makePublicAssetUrl('/images/logo.svg')} />
        <StyledLogoText>
          <LogoText />
        </StyledLogoText>
        {children}
      </Contents>
    </Wrapper>
  )
}
