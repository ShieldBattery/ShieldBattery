import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { makeLeagueId } from '../../common/leagues/leagues'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { FragmentType, graphql, useFragment } from '../gql'
import { MatchmakingType as GqlMatchmakingType } from '../gql/graphql'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { OutlinedButton, useButtonState } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { Tooltip } from '../material/tooltip'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyMedium, singleLine, titleSmall } from '../styles/typography'
import { urlForLeague } from './action-creators'
import { LeagueBadge } from './league-badge'

export const Leagues_HomeFeedFragment = graphql(/* GraphQL */ `
  fragment Leagues_HomeFeedFragment on Query {
    activeLeagues {
      id
      ...Leagues_HomeFeedEntryFragment
    }

    futureLeagues {
      id
      ...Leagues_HomeFeedEntryFragment
    }
  }
`)

const Root = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  border-radius: 4px;
`

const ListButtonContainer = styled.div`
  padding-block: 8px 4px;
  text-align: center;
`

export function LeagueHomeFeed({
  query,
  title,
}: {
  query?: FragmentType<typeof Leagues_HomeFeedFragment>
  title: React.ReactNode
}) {
  const { t } = useTranslation()
  const { activeLeagues, futureLeagues } = useFragment(Leagues_HomeFeedFragment, query) ?? {
    activeLeagues: [],
    futureLeagues: [],
  }

  const shownLeagues = activeLeagues.concat(futureLeagues).slice(0, 4)

  return shownLeagues.length > 0 ? (
    <>
      {title}
      <Root>
        {shownLeagues.map(league => (
          <LeagueEntry key={league.id} query={league} />
        ))}
        <ListButtonContainer>
          <LinkButton href='/leagues'>
            <OutlinedButton
              $as='div'
              label={t('leagues.list.viewAll', 'View all leagues')}
              tabIndex={0}
            />
          </LinkButton>
        </ListButtonContainer>
      </Root>
    </>
  ) : null
}

export const Leagues_HomeFeedEntryFragment = graphql(/* GraphQL */ `
  fragment Leagues_HomeFeedEntryFragment on League {
    id
    name
    matchmakingType
    startAt
    endAt
  }
`)

const LeagueEntryRoot = styled(LinkButton)`
  padding: 12px 16px;

  display: flex;
  gap: 16px;
  align-items: center;

  border-radius: inherit;
  contain: content;
`

const StyledLeagueBadge = styled(LeagueBadge)`
  flex-grow: 0;
  flex-shrink: 0;
`

const Info = styled.div`
  min-width: 0;
  flex-grow: 1;
  flex-shrink: 1;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const LeagueName = styled.div`
  ${singleLine};
  flex-shrink: 1;
`

const LeagueTypeAndDates = styled.div`
  ${bodyMedium};
  display: flex;
  gap: 8px;

  color: var(--theme-on-surface-variant);
`
const LeagueType = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface);
`

function toNormalMatchmakingType(gqlType: GqlMatchmakingType): MatchmakingType {
  switch (gqlType) {
    case GqlMatchmakingType.Match_1V1:
      return MatchmakingType.Match1v1
    case GqlMatchmakingType.Match_1V1Fastest:
      return MatchmakingType.Match1v1Fastest
    case GqlMatchmakingType.Match_2V2:
      return MatchmakingType.Match2v2
    default:
      return gqlType satisfies never
  }
}

function LeagueEntry({ query }: { query: FragmentType<typeof Leagues_HomeFeedEntryFragment> }) {
  const { t } = useTranslation()
  const league = useFragment(Leagues_HomeFeedEntryFragment, query)
  const url = urlForLeague(makeLeagueId(league.id), league)
  const [buttonProps, rippleRef] = useButtonState({})

  const startAt = Number(new Date(league.startAt))
  const endAt = Number(new Date(league.endAt))
  const curDate = Date.now()

  return (
    <LeagueEntryRoot {...buttonProps} href={url}>
      <StyledLeagueBadge league={league} />
      <Info>
        <LeagueName>{league.name}</LeagueName>
        <LeagueTypeAndDates>
          <LeagueType>
            {matchmakingTypeToLabel(toNormalMatchmakingType(league.matchmakingType), t)}
          </LeagueType>
          <span>·</span>
          {startAt <= curDate ? (
            <RunningLeagueDate curDate={curDate} endAt={endAt} />
          ) : (
            <FutureLeagueDate curDate={curDate} startAt={startAt} />
          )}
        </LeagueTypeAndDates>
      </Info>
      <Ripple ref={rippleRef} />
    </LeagueEntryRoot>
  )
}

const RunningText = styled.div`
  color: var(--theme-amber);
`

function RunningLeagueDate({ curDate, endAt }: { curDate: number; endAt: number }) {
  const { t } = useTranslation()
  const text = t('leagues.list.ends', {
    defaultValue: 'Ends {{endDate}}',
    endDate: narrowDuration.format(endAt, curDate),
  })
  const tooltip = longTimestamp.format(endAt)
  return (
    <>
      <RunningText>{t('leagues.list.runningNow', 'Running now!')}</RunningText>
      <span>·</span>
      <Tooltip text={tooltip} position='top'>
        <span>{text}</span>
      </Tooltip>
    </>
  )
}

function FutureLeagueDate({ curDate, startAt }: { curDate: number; startAt: number }) {
  const { t } = useTranslation()
  const text = t('leagues.list.starts', {
    defaultValue: 'Starts {{startDate}}',
    startDate: narrowDuration.format(startAt, curDate),
  })
  const tooltip = longTimestamp.format(startAt)
  return (
    <Tooltip text={tooltip} position='top'>
      <span>{text}</span>
    </Tooltip>
  )
}
