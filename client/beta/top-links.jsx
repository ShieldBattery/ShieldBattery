import React from 'react'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import GithubLogo from './github.svg'

import { STARCRAFT_DOWNLOAD_URL } from '../../common/constants'
import { amberA400 } from '../styles/colors'

const TopLinksList = styled.ul`
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

  li:not(:first-child) {
    margin-left: 32px;

    @media screen and (max-width: 600px) {
      margin-left: 16px;
    }
  }
`

const BroodWarLink = styled.li`
  @media screen and (max-width: 600px) {
    display: none;
  }
`

const GithubLink = styled.li`
  display: flex;
  align-items: center;

  @media screen and (max-width: 600px) {
    margin-left: 16px;
  }
`

const StyledGithubLogo = styled(GithubLogo)`
  width: 16px;
  color: ${amberA400};
  margin-right: 8px;
`

const Spacer = styled.div`
  flex: 1 1 auto;

  @media screen and (max-width: 600px) {
    display: none;
  }
`

const TopLinks = () => {
  return (
    <TopLinksList>
      <li>
        <Link to='/splash'>Home</Link>
      </li>
      <BroodWarLink>
        <a href={STARCRAFT_DOWNLOAD_URL} target='_blank' rel='nofollow noreferrer'>
          Download Brood War
        </a>
      </BroodWarLink>
      <li>
        <Link to='/faq'>FAQ</Link>
      </li>
      <li>
        <a href='https://twitter.com/shieldbatterybw' target='_blank'>
          Twitter
        </a>
      </li>
      <Spacer />
      <GithubLink>
        <StyledGithubLogo />
        <a href='https://github.com/ShieldBattery' target='_blank'>
          View on GitHub
        </a>
      </GithubLink>
      <Spacer />
      <li>
        <Link to='/login'>Log in</Link>
      </li>
    </TopLinksList>
  )
}

export default TopLinks
