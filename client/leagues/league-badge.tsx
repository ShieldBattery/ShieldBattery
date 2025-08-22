import styled, { css } from 'styled-components'
import { LeagueId } from '../../common/leagues/leagues'
import { randomColorForString } from '../avatars/colors'
import { FragmentType, graphql, useFragment } from '../gql'
import { useAppSelector } from '../redux-hooks'
import { pickTextColor } from '../styles/colors'
import { headlineLarge } from '../styles/typography'

const badgeCommon = css`
  width: 40px;
  height: 40px;
  border-radius: 10px;
  contain: content;
`

const LeagueBadgePlaceholder = styled.svg`
  ${badgeCommon};
  background-color: var(--sb-badge-color, var(--color-blue70));
  color: var(--sb-badge-text-color, var(--theme-on-surface));
`

const PlaceholderTextContainer = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;
`

const PlaceholderText = styled.div`
  ${headlineLarge};
  font-size: 28px;
  line-height: 40px;
`

const LeagueBadgeImage = styled.img`
  ${badgeCommon};
  object-fit: cover;
`

export interface LeagueBadgeProps {
  leagueName: string
  badgeUrl?: string
  className?: string
}

export function LeagueBadge({ leagueName, badgeUrl, className }: LeagueBadgeProps) {
  if (badgeUrl) {
    return (
      <LeagueBadgeImage
        src={badgeUrl}
        className={className}
        alt={`${leagueName} badge`}
        draggable={false}
      />
    )
  }

  const badgeColor = randomColorForString(leagueName)
  const textColor = pickTextColor(badgeColor)

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
          <PlaceholderText>{(leagueName[0] ?? '-').toUpperCase()}</PlaceholderText>
        </PlaceholderTextContainer>
      </foreignObject>
    </LeagueBadgePlaceholder>
  )
}

export function ReduxLeagueBadge({
  leagueId,
  className,
}: {
  leagueId: LeagueId
  className?: string
}) {
  const league = useAppSelector(s => s.leagues.byId.get(leagueId))

  // TODO(tec27): Call some batch API to get this data
  if (!league) {
    return null
  }

  return <LeagueBadge leagueName={league.name} badgeUrl={league.badgePath} className={className} />
}

const Leagues_LeagueBadgeFragment = graphql(/* GraphQL */ `
  fragment Leagues_LeagueBadgeFragment on League {
    name
    badgeUrl
  }
`)

export function GqlLeagueBadge({
  query,
  className,
}: {
  query: FragmentType<typeof Leagues_LeagueBadgeFragment>
  className?: string
}) {
  const league = useFragment(Leagues_LeagueBadgeFragment, query)
  return (
    <LeagueBadge
      leagueName={league.name}
      badgeUrl={league.badgeUrl ?? undefined}
      className={className}
    />
  )
}
