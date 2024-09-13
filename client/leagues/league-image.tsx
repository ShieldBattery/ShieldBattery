import React from 'react'
import { css, styled } from 'styled-components'
import { LEAGUE_IMAGE_HEIGHT, LEAGUE_IMAGE_WIDTH } from '../../common/leagues/index.js'
import { useObservedDimensions } from '../dom/dimension-hooks.js'
import { MaterialIcon } from '../icons/material/material-icon.js'
import { background600, colorTextFaint } from '../styles/colors.js'

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

const PlaceholderContainer = styled.div`
  ${leagueImageCommon};
  color: ${colorTextFaint};

  display: flex;
  align-items: center;
  justify-content: center;
`

export function LeaguePlaceholderImage() {
  const [ref, rect] = useObservedDimensions()

  return (
    <PlaceholderContainer ref={ref}>
      {rect ? (
        <MaterialIcon icon='social_leaderboard' size={Math.round(rect.width * 0.22727272)} />
      ) : undefined}
    </PlaceholderContainer>
  )
}
