import React from 'react'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import GithubLogo from './github.svg'

import { STARCRAFT_DOWNLOAD_URL } from '../../common/constants'
import { amberA400 } from '../styles/colors'

const TopLinksList = styled.ul`
  display: flex;
  align-items: center;
  position: relative;
  pointer-events: all;
  list-style: none;
  margin: 8px 0px;
  padding: 0px;
  height: 22px;

  & > li + li {
    margin-left: 32px;
  }
`

const GithubLink = styled.li`
  display: flex;
  align-items: center;
  margin: 0px 224px 0px 172px !important;
`

const StyledGithubLogo = styled(GithubLogo)`
  width: 16px;
  color: ${amberA400};
  margin-right: 8px;
`

const TopLinks = () => {
  return (
    <TopLinksList>
      <li>
        <Link to='/splash'>Home</Link>
      </li>
      <li>
        <a href={STARCRAFT_DOWNLOAD_URL} target='_blank' rel='nofollow noreferrer'>
          Download Brood War
        </a>
      </li>
      <li>
        <Link to='/faq'>FAQ</Link>
      </li>
      <li>
        <a href='https://twitter.com/shieldbatterybw' target='_blank'>
          Twitter
        </a>
      </li>
      <GithubLink>
        <StyledGithubLogo />
        <a href='https://github.com/ShieldBattery' target='_blank'>
          View on GitHub
        </a>
      </GithubLink>
      <li>
        <Link to='/login'>Log in</Link>
      </li>
    </TopLinksList>
  )
}

export default TopLinks
