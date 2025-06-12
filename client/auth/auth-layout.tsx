import * as React from 'react'
import styled from 'styled-components'
import Logo from '../logos/logo-no-bg.svg'
import { CenteredContentContainer } from '../styles/centered-container'
import { HeadlineSmall } from '../styles/typography'

const Root = styled.div`
  width: 100%;
  min-height: calc(100% - 48px);
  padding-block: 24px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  gap: 32px;
`

const LogoAndTitle = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;

  text-align: center;
`

const StyledLogo = styled(Logo)`
  width: 172px;
  height: auto;
`

export function AuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <CenteredContentContainer $targetWidth={420}>
      <Root>
        <LogoAndTitle>
          <StyledLogo />
          <HeadlineSmall>{title}</HeadlineSmall>
        </LogoAndTitle>
        {children}
      </Root>
    </CenteredContentContainer>
  )
}
