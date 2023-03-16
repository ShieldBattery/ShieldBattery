import React from 'react'
import styled, { css } from 'styled-components'
import { LEAGUE_IMAGE_HEIGHT, LEAGUE_IMAGE_WIDTH } from '../../common/leagues'
import LeaguesIcon from '../icons/material/social_leaderboard-36px.svg'
import { background600, colorTextFaint } from '../styles/colors'

const leagueImageCommon = css`
  width: 100%;
  height: auto;
  aspect-ratio: ${LEAGUE_IMAGE_WIDTH} / ${LEAGUE_IMAGE_HEIGHT};
  background-color: ${background600};
  border-radius: 2px;
  contain: content;
`

export const LeagueImageContainer = styled.div`
  ${leagueImageCommon};
  overflow: hidden;

  & > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

export function LeagueImage({ src }: { src: string }) {
  return (
    <LeagueImageContainer>
      <img src={src} alt='' draggable={false} />
    </LeagueImageContainer>
  )
}

export const LeaguePlaceholderIcon = styled(LeaguesIcon)`
  width: 22.727272%;
  height: auto;
`

export const LeaguePlaceholderImage = styled.div.attrs(() => ({
  children: <LeaguePlaceholderIcon />,
}))`
  ${leagueImageCommon};
  color: ${colorTextFaint};

  display: flex;
  align-items: center;
  justify-content: center;
`
