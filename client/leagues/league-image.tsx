import React from 'react'
import styled, { css } from 'styled-components'
import { LEAGUE_IMAGE_HEIGHT, LEAGUE_IMAGE_WIDTH } from '../../common/leagues'
import LeaguesIcon from '../icons/material/social_leaderboard-36px.svg'
import { background600, colorTextFaint } from '../styles/colors'

const leagueImageCommon = css`
  width: 100%;
  aspect-ratio: ${LEAGUE_IMAGE_WIDTH} / ${LEAGUE_IMAGE_HEIGHT};
  background-color: ${background600};
  border-radius: 2px;
`

export const LeagueImage = styled.img.attrs(() => ({
  alt: '',
  draggable: false,
}))`
  ${leagueImageCommon};
  object-fit: cover;
`

export const LeaguePlaceholderIcon = styled(LeaguesIcon)`
  width: 22.727272%;
  height: auto;
`

export const LeaguePlaceholderImage = styled.div.attrs(() => ({
  children: <LeaguePlaceholderIcon />,
}))`
  ${leagueImageCommon};
  color: ${colorTextFaint};
  contain: content;

  display: flex;
  align-items: center;
  justify-content: center;
`
