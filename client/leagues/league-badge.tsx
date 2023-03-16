import { meetsContrastGuidelines } from 'polished'
import React from 'react'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { ClientLeagueId, LeagueJson } from '../../common/leagues'
import { randomColorForString } from '../avatars/colors'
import { useAppSelector } from '../redux-hooks'
import { blue400, colorTextInvert, colorTextPrimary } from '../styles/colors'
import { headline3 } from '../styles/typography'

const badgeCommon = css`
  width: 40px;
  height: 40px;
  border-radius: 9999px;
  contain: content;
`

const LeagueBadgePlaceholder = styled.svg`
  ${badgeCommon};
  background-color: var(--sb-badge-color, ${blue400});
  color: var(--sb-badge-text-color, ${colorTextPrimary});
`

const PlaceholderTextContainer = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;
`

const PlaceholderText = styled.div`
  ${headline3};
  font-size: 28px;
  line-height: 40px;
`

const LeagueBadgeImage = styled.img`
  ${badgeCommon};
  object-fit: cover;
`

export interface LeagueBadgeProps {
  league: ReadonlyDeep<LeagueJson>
  className?: string
}

export function LeagueBadge({ league, className }: LeagueBadgeProps) {
  if (league.badgePath) {
    return (
      <LeagueBadgeImage
        src={league.badgePath}
        className={className}
        alt={`${league.name} badge`}
        draggable={false}
      />
    )
  }

  const badgeColor = randomColorForString(league.name)
  const textColor = meetsContrastGuidelines(badgeColor, colorTextPrimary)
    ? colorTextPrimary
    : colorTextInvert

  return (
    <LeagueBadgePlaceholder
      width='40'
      height='40'
      viewBox='0 0 40 40'
      preserveAspectRatio='xMinYMin meet'
      className={className}
      style={
        {
          '--sb-badge-color': badgeColor,
          '--sb-badge-text-color': textColor,
        } as any
      }>
      <foreignObject width='100%' height='100%'>
        <PlaceholderTextContainer>
          <PlaceholderText>{(league.name[0] ?? '-').toUpperCase()}</PlaceholderText>
        </PlaceholderTextContainer>
      </foreignObject>
    </LeagueBadgePlaceholder>
  )
}

export function ConnectedLeagueBadge({
  leagueId,
  className,
}: {
  leagueId: ClientLeagueId
  className?: string
}) {
  const league = useAppSelector(s => s.leagues.byId.get(leagueId))

  // TODO(tec27): Call some batch API to get this data
  if (!league) {
    return null
  }

  return <LeagueBadge league={league} className={className} />
}
