import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { IterableElement } from 'type-fest'
import { makeLeagueId } from '../../common/leagues/leagues'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { FragmentType, graphql, useFragment } from '../gql'
import { HomeSection, HomeSectionTitle } from '../home/home-section'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { OutlinedButton, useButtonState } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { Tooltip } from '../material/tooltip'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyMedium, singleLine, titleSmall } from '../styles/typography'
import { urlForLeague } from './action-creators'
import { GqlLeagueBadge } from './league-badge'

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
}: {
  query?: FragmentType<typeof Leagues_HomeFeedFragment>
}) {
  const { t } = useTranslation()
  const { activeLeagues, futureLeagues } = useFragment(Leagues_HomeFeedFragment, query) ?? {
    activeLeagues: [],
    futureLeagues: [],
  }

  const shownLeagues = (
    activeLeagues as Array<
      IterableElement<typeof activeLeagues> | IterableElement<typeof futureLeagues>
    >
  )
    .concat(futureLeagues)
    .slice(0, 4)

  return shownLeagues.length > 0 ? (
    <HomeSection>
      <HomeSectionTitle>{t('leagues.activity.title', 'Leagues')}</HomeSectionTitle>
      <Root>
        {shownLeagues.map(league => (
          <LeagueEntry key={league.id} query={league} />
        ))}
        <ListButtonContainer>
          <LinkButton href='/leagues'>
            <OutlinedButton
              styledAs='div'
              label={t('leagues.list.viewAll', 'View all leagues')}
              tabIndex={0}
            />
          </LinkButton>
        </ListButtonContainer>
      </Root>
    </HomeSection>
  ) : null
}

export const Leagues_HomeFeedEntryFragment = graphql(/* GraphQL */ `
  fragment Leagues_HomeFeedEntryFragment on League {
    id
    name
    matchmakingType
    startAt
    endAt
    ...Leagues_LeagueBadgeFragment
  }
`)

const LeagueEntryRoot = styled(LinkButton)`
  padding: 12px 16px;

  display: flex;
  gap: 16px;
  align-items: flex-start;

  border-radius: inherit;
  contain: content;
`

const StyledLeagueBadge = styled(GqlLeagueBadge)`
  flex-grow: 0;
  flex-shrink: 0;
  margin-block: 2px;
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
  align-items: center;
  column-gap: 8px;
  flex-wrap: wrap;
  color: var(--theme-on-surface-variant);
`

const LeagueType = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface);
  white-space: nowrap;
`

const NoWrapSpan = styled.span`
  white-space: nowrap;
`

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
      <StyledLeagueBadge query={league} />
      <Info>
        <LeagueName>{league.name}</LeagueName>
        <LeagueTypeAndDates>
          <LeagueType>{matchmakingTypeToLabel(league.matchmakingType, t)}</LeagueType>
          <NoWrapSpan>·</NoWrapSpan>
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
  white-space: nowrap;
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
      <NoWrapSpan>·</NoWrapSpan>
      <Tooltip text={tooltip} position='top'>
        <NoWrapSpan>{text}</NoWrapSpan>
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
      <NoWrapSpan>{text}</NoWrapSpan>
    </Tooltip>
  )
}
