import React from 'react'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import GithubLogo from './github.svg'
import TwitterLogo from './twitter.svg'

import { STARCRAFT_DOWNLOAD_URL } from '../../common/constants'
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
  }
`

const BroodWarLink = styled.li`
  @media screen and (max-width: 720px) {
    display: none;
  }
`

const IconLink = styled.a`
  display: flex;
  align-items: center;
`

const StyledGithubLogo = styled(GithubLogo)`
  width: 16px;
  height: auto;
  color: ${amberA400};
  margin-right: 8px;
`

const StyledTwitterLogo = styled(TwitterLogo)`
  width: 16px;
  height: auto;
  color: ${amberA400};
  margin-right: 8px;
`

const Spacer = styled.div`
  flex: 1 1 auto;

  @media screen and (max-width: 720px) {
    width: 16px;
    flex: 0 0;
  }
`

const TopLinks = () => {
  return (
    <TopLinksList>
      <li>
        <Link to='/splash'>Home</Link>
      </li>
      <BroodWarLink>
        <a href={STARCRAFT_DOWNLOAD_URL} target='_blank' rel='nofollow noreferrer noopener'>
          Download Brood War
        </a>
      </BroodWarLink>
      <li>
        <Link to='/faq'>FAQ</Link>
      </li>
      <Spacer />
      <li>
        <IconLink href='https://twitter.com/shieldbatterybw' target='_blank' rel='noopener'>
          <StyledTwitterLogo />
          Twitter
        </IconLink>
      </li>
      <li>
        <IconLink href='https://github.com/ShieldBattery' target='_blank' rel='noopener'>
          <StyledGithubLogo />
          GitHub
        </IconLink>
      </li>
      <li>
        <a href='https://patreon.com/tec27' target='_blank' rel='noopener'>
          Patreon
        </a>
      </li>
      <Spacer />
      <li>
        <Link to='/login'>Log in</Link>
      </li>
    </TopLinksList>
  )
}

export default TopLinks
