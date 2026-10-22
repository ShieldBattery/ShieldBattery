import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { LeagueJson, UserLeagueStanding } from '../../common/leagues/leagues'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { useButtonState } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { useAppSelector } from '../redux-hooks'
import {
  bodySmall,
  labelSmall,
  singleLine,
  sofiaSans,
  titleLarge,
  titleMedium,
} from '../styles/typography'
import { urlForLeague } from './action-creators'
import { DetailsSubPage } from './details-sub-page'
import { LeagueBadge } from './league-badge'

const StandingsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const StandingRoot = styled.div`
  position: relative;
  min-height: 64px;
  padding: 12px 16px;

  display: flex;
  align-items: center;
  gap: 16px;

  background-color: var(--theme-container-low);
  border-radius: 8px;
  contain: content;
`

const Badge = styled(LeagueBadge)`
  flex-shrink: 0;
`

const NameAndFormat = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
`

const LeagueName = styled.div`
  ${titleMedium};
  ${singleLine};
`

const LeagueFormat = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const Stats = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 24px;
`

const Stat = styled.div`
  min-width: 56px;

  display: flex;
  flex-direction: column;
  align-items: flex-end;
`

const StatLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
`

const StatValue = styled.div`
  ${titleLarge};
  ${sofiaSans};
  font-variant-numeric: tabular-nums;
`

const RankValue = styled(StatValue)<{ $isTopRank: boolean }>`
  color: ${props => (props.$isTopRank ? 'var(--theme-amber)' : 'inherit')};
`

/** Muted statistics distinguish memberships without a ranked result. */
const UnrankedStatValue = styled(StatValue)`
  color: var(--theme-on-surface-variant);
`

const Wins = styled.span`
  color: var(--theme-positive);
`

const Losses = styled.span`
  color: var(--theme-negative);
`

/** Places on a leaderboard that are highlighted as podium finishes. */
const TOP_RANK_CUTOFF = 3

/**
 * Shows a user's place, points, and record in each of the given running leagues, linking to each
 * league's leaderboard. Leagues they haven't played in yet are shown as unranked.
 */
export function UserLeagueStandings({
  standings,
  className,
}: {
  standings: ReadonlyDeep<UserLeagueStanding[]>
  className?: string
}) {
  const leaguesById = useAppSelector(s => s.leagues.byId)

  return (
    <StandingsList className={className}>
      {standings.map(standing => {
        const league = leaguesById.get(standing.leagueId)
        return league ? (
          <LeagueStandingRow key={standing.leagueId} league={league} standing={standing} />
        ) : null
      })}
    </StandingsList>
  )
}

function LeagueStandingRow({
  league,
  standing,
}: {
  league: ReadonlyDeep<LeagueJson>
  standing: ReadonlyDeep<UserLeagueStanding>
}) {
  const { t } = useTranslation()
  const [buttonProps, rippleRef] = useButtonState({})
  const { rank } = standing

  return (
    <LinkButton href={urlForLeague(league.id, league, DetailsSubPage.Leaderboard)} tabIndex={0}>
      <StandingRoot {...buttonProps}>
        <Badge leagueName={league.name} badgeUrl={league.badgePath} />
        <NameAndFormat>
          <LeagueName>{league.name}</LeagueName>
          <LeagueFormat>{matchmakingTypeToLabel(league.matchmakingType, t)}</LeagueFormat>
        </NameAndFormat>
        {rank !== undefined ? (
          <Stats>
            <Stat>
              <StatLabel>{t('users.profile.leagues.rank', 'Rank')}</StatLabel>
              <RankValue $isTopRank={rank <= TOP_RANK_CUTOFF}>
                {t('users.profile.leagues.rankValue', { defaultValue: '#{{rank}}', rank })}
              </RankValue>
            </Stat>
            <Stat>
              <StatLabel>{t('users.profile.leagues.points', 'Points')}</StatLabel>
              <StatValue>{Math.round(standing.points)}</StatValue>
            </Stat>
            <Stat>
              <StatLabel>{t('users.profile.leagues.record', 'Record')}</StatLabel>
              <StatValue>
                <Wins>{standing.wins}</Wins>&ndash;<Losses>{standing.losses}</Losses>
              </StatValue>
            </Stat>
          </Stats>
        ) : (
          <Stats>
            <Stat>
              <StatLabel>{t('users.profile.leagues.rank', 'Rank')}</StatLabel>
              <UnrankedStatValue>
                {t('users.profile.leagues.unranked', 'Unranked')}
              </UnrankedStatValue>
            </Stat>
            <Stat>
              <StatLabel>{t('users.profile.leagues.points', 'Points')}</StatLabel>
              <UnrankedStatValue>{Math.round(standing.points)}</UnrankedStatValue>
            </Stat>
            <Stat>
              <StatLabel>{t('users.profile.leagues.record', 'Record')}</StatLabel>
              <UnrankedStatValue>
                {standing.wins}&ndash;{standing.losses}
              </UnrankedStatValue>
            </Stat>
          </Stats>
        )}
        <Ripple ref={rippleRef} />
      </StandingRoot>
    </LinkButton>
  )
}
