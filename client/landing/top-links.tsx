import React from 'react'
import styled from 'styled-components'
import { Link } from 'wouter'
import GithubLogo from '../icons/brands/github.svg'
import TwitterLogo from '../icons/brands/twitter.svg'
import { amberA400 } from '../styles/colors'
import { body2 } from '../styles/typography'

const TopLinksList = styled.ul`
  ${body2};

  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  pointer-events: all;
  list-style: none;
  width: 100%;
  max-width: 890px;
  margin: 8px 0px;
  padding: 0px 16px;
  height: 22px;

  @media screen and (max-width: 720px) {
    justify-content: space-around;
  }

  li:not(:first-child) {
    margin-left: 32px;

    @media screen and (max-width: 720px) {
      margin-left: 16px;
    }

    @media screen and (max-width: 500px) {
      margin-left: 8px;
    }
  }
`

const IconLink = styled.a`
  display: flex;
  align-items: center;
`

const StyledGithubLogo = styled(GithubLogo)`
  width: auto;
  height: 18px;
  color: ${amberA400};
  margin-right: 8px;
`

const StyledTwitterLogo = styled(TwitterLogo)`
  width: auto;
  /** The Twitter icon doesn't have built-in padding so it appears a bit larger. */
  height: 16px;
  color: ${amberA400};
  margin-right: 8px;
`

const Spacer = styled.div`
  flex: 1 1 auto;

  @media screen and (max-width: 720px) {
    width: 16px;
    flex: 0 0;
  }

  @media screen and (max-width: 500px) {
    width: 8px;
    flex: 0 0;
  }
`

const HideWhenSmall = styled.span`
  @media screen and (max-width: 720px) {
    display: none;
  }
`

const TopLinks = () => {
  return (
    <TopLinksList>
      <li>
        <Link href='/splash'>Home</Link>
      </li>
      <li>
        <Link href='/faq'>FAQ</Link>
      </li>
      <li>
        <Link href='/ladder'>Ladder</Link>
      </li>
      <li>
        <Link href='/leagues'>Leagues</Link>
      </li>
      <Spacer />
      <li>
        <IconLink href='https://twitter.com/shieldbatterybw' target='_blank' rel='noopener'>
          <StyledTwitterLogo />
          <HideWhenSmall>Twitter</HideWhenSmall>
        </IconLink>
      </li>
      <li>
        <IconLink href='https://github.com/ShieldBattery' target='_blank' rel='noopener'>
          <StyledGithubLogo />
          <HideWhenSmall>GitHub</HideWhenSmall>
        </IconLink>
      </li>
      <li>
        <HideWhenSmall>
          <a href='https://patreon.com/tec27' target='_blank' rel='noopener'>
            Patreon
          </a>
        </HideWhenSmall>
      </li>
      <Spacer />
      <li>
        <Link href='/login'>Log&nbsp;in</Link>
      </li>
    </TopLinksList>
  )
}

export default TopLinks
