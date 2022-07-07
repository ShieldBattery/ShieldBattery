import React from 'react'
import styled from 'styled-components'
import { LadderPlayer } from '../../common/ladder'
import {
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  NUM_PLACEMENT_MATCHES,
  ratingToMatchmakingDivision,
} from '../../common/matchmaking'
import { makePublicAssetUrl } from '../network/server-url'
import { singleLine } from '../styles/typography'

export interface RankIconProps {
  rating: number
  rank: number
  className?: string
  /** Whether to add text to Champion-rated players showing their current rank. */
  showChampionRank?: boolean
  /** The pixel size the icon will be displayed at. Defaults to 88px. */
  size?: number
}

const Container = styled.div`
  position: relative;
  width: 88px;
  height: 88px;
`

const StyledImage = styled.img`
  width: 100%;
  height: auto;
`

// NOTE(tec27): We use an SVG here to get the text to scale based on the container width. This would
// be more easily doable with `vi` or `vb` units but alas, not supported by Chrome yet :(
const RankContainer = styled.svg`
  position: absolute;
  width: 100%;
  left: 0;
  bottom: 0;
  pointer-events: none;
`

const RankText = styled.div`
  ${singleLine};
  font-weight: 500;
  font-size: 16px;
  line-height: 24px;
  text-align: center;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.87);
`

export function RankIcon({
  rating,
  rank,
  className,
  showChampionRank = true,
  size = 88,
}: RankIconProps) {
  const division = ratingToMatchmakingDivision(rating, rank)
  const encodedDivision = encodeURIComponent(division)
  const svgUrl = makePublicAssetUrl(`images/ranks/${encodedDivision}.svg`)
  const srcSet = `
    ${makePublicAssetUrl(`/images/ranks/${encodedDivision}-22px.png`)} 22w,
    ${makePublicAssetUrl(`/images/ranks/${encodedDivision}-44px.png`)} 44w,
    ${makePublicAssetUrl(`/images/ranks/${encodedDivision}-88px.png`)} 88w,
    ${svgUrl} 176w
  `
  const divisionLabel = matchmakingDivisionToLabel(division)

  return (
    <Container className={className}>
      <StyledImage
        src={svgUrl}
        srcSet={srcSet}
        sizes={`${size}px`}
        alt={divisionLabel}
        draggable='false'
      />
      {showChampionRank && division === MatchmakingDivision.Champion ? (
        <RankContainer viewBox='0 0 88 88' xmlns='http://www.w3.org/2000/svg'>
          <foreignObject x='0' y='60' width='88' height='24'>
            <RankText>{rank}</RankText>
          </foreignObject>
        </RankContainer>
      ) : null}
    </Container>
  )
}

export interface UnratedIconProps {
  className?: string
  /** The pixel size the icon will be displayed at. Defaults to 88px. */
  size?: number
}

export function UnratedIcon({ className, size = 88 }: UnratedIconProps) {
  const svgUrl = makePublicAssetUrl('images/ranks/unrated.svg')
  const srcSet = `
    ${makePublicAssetUrl(`/images/ranks/unrated-22px.png`)} 22w,
    ${makePublicAssetUrl(`/images/ranks/unrated-44px.png`)} 44w,
    ${makePublicAssetUrl(`/images/ranks/unrated-88px.png`)} 88w,
    ${svgUrl} 176w
  `
  const divisionLabel = matchmakingDivisionToLabel(MatchmakingDivision.Unrated)

  return (
    <Container className={className}>
      <StyledImage
        src={svgUrl}
        srcSet={srcSet}
        sizes={`${size}px`}
        alt={divisionLabel}
        draggable='false'
      />
    </Container>
  )
}

export interface LadderPlayerIconProps {
  player: Readonly<LadderPlayer>
  className?: string
  /** The pixel size the icon will be displayed at. Defaults to 88px. */
  size?: number
}

export function LadderPlayerIcon({ player, className, size }: LadderPlayerIconProps) {
  if (player.lifetimeGames < NUM_PLACEMENT_MATCHES) {
    return <UnratedIcon className={className} size={size} />
  } else {
    return <RankIcon rating={player.rating} rank={player.rank} className={className} size={size} />
  }
}
