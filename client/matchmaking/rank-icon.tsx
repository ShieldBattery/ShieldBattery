import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LadderPlayer } from '../../common/ladder'
import {
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  NUM_PLACEMENT_MATCHES,
  ratingToMatchmakingDivision,
} from '../../common/matchmaking'
import { makePublicAssetUrl } from '../network/server-url'

export interface RankIconProps {
  rating: number
  className?: string
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

export function RankIcon({ rating, className, size = 88 }: RankIconProps) {
  const division = ratingToMatchmakingDivision(rating)
  return <DivisionIcon className={className} size={size} division={division} />
}

export interface UnratedIconProps {
  className?: string
  /** The pixel size the icon will be displayed at. Defaults to 88px. */
  size?: number
}

export function UnratedIcon({ className, size = 88 }: UnratedIconProps) {
  return <DivisionIcon className={className} size={size} division={MatchmakingDivision.Unrated} />
}

export interface DivisionIconProps {
  division: MatchmakingDivision
  className?: string
  /** The pixel size the icon will be displayed at. Defaults to 88px. */
  size?: number
}

export function DivisionIcon({ className, division, size }: DivisionIconProps) {
  const { t } = useTranslation()
  const encodedDivision = encodeURIComponent(division)
  const svgUrl = makePublicAssetUrl(`images/ranks/${encodedDivision}.svg`)
  const srcSet = `
    ${makePublicAssetUrl(`/images/ranks/${encodedDivision}-22px.png`)} 22w,
    ${makePublicAssetUrl(`/images/ranks/${encodedDivision}-44px.png`)} 44w,
    ${makePublicAssetUrl(`/images/ranks/${encodedDivision}-88px.png`)} 88w,
    ${svgUrl} 176w
  `
  const divisionLabel = matchmakingDivisionToLabel(division, t)

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
    return <RankIcon rating={player.rating} className={className} size={size} />
  }
}
