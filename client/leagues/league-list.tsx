import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { Link, Route, Switch } from 'wouter'
import { assertUnreachable } from '../../common/assert-unreachable'
import { ClientLeagueId, ClientLeagueUserJson, LeagueJson } from '../../common/leagues'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { hasAnyPermission } from '../admin/admin-permissions'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { longTimestamp, monthDay, narrowDuration } from '../i18n/date-formats'
import CheckIcon from '../icons/material/check-24px.svg'
import logger from '../logging/logger'
import { TextButton, useButtonState } from '../material/button'
import Card from '../material/card'
import { Ripple } from '../material/ripple'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { colorError, colorTextFaint, colorTextSecondary } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import { body1, caption, headline4, headline6, subtitle1 } from '../styles/typography'
import { getLeaguesList, navigateToLeague } from './action-creators'
import { LeagueDetailsPage } from './league-details'
import { LeagueImage, LeaguePlaceholderImage } from './league-image'

const LoadableLeagueAdmin = React.lazy(async () => ({
  default: (await import('./league-admin')).LeagueAdmin,
}))

export function LeagueRoot(props: { params: any }) {
  const isAdmin = useAppSelector(s => hasAnyPermission(s.auth, 'manageLeagues'))

  return (
    <Suspense fallback={<LoadingDotsArea />}>
      <Switch>
        {isAdmin ? <Route path='/leagues/admin/:rest*' component={LoadableLeagueAdmin} /> : <></>}
        <Route path='/leagues/:id/:rest*' component={LeagueDetailsPage} />
        <Route component={LeagueList} />
      </Switch>
    </Suspense>
  )
}

const ListRoot = styled.div`
  max-width: 1120px;
  padding: 12px 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const TitleRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 16px;
`

const Title = styled.div`
  ${headline4};
`

const ErrorText = styled.div`
  ${subtitle1};
  color: ${colorError};
`

enum LeagueSectionType {
  Past,
  Current,
  Future,
}

function LeagueList() {
  const dispatch = useAppDispatch()
  const isAdmin = useAppSelector(s => hasAnyPermission(s.auth, 'manageLeagues'))
  const { past, current, future, byId, selfLeagues } = useAppSelector(s => s.leagues)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error>()

  const { pastLeagues, currentLeagues, futureLeagues } = useMemo(() => {
    const pastLeagues = past.map(id => byId.get(id)!)
    const currentLeagues = current.map(id => byId.get(id)!)
    const futureLeagues = future.map(id => byId.get(id)!)

    return { pastLeagues, currentLeagues, futureLeagues }
  }, [past, current, future, byId])

  const onHowItWorksClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      dispatch(
        openDialog({
          type: DialogType.LeagueExplainer,
        }),
      )
    },
    [dispatch],
  )

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    setIsLoading(true)

    dispatch(
      getLeaguesList({
        signal,
        onSuccess(res) {
          setIsLoading(false)
          setError(undefined)
        },
        onError(err) {
          setIsLoading(false)
          setError(err)
          logger.error(`Error loading leagues list: ${err.stack ?? err}`)
        },
      }),
    )

    return () => controller.abort()
  }, [dispatch])

  return (
    <ListRoot>
      <TitleRow>
        <Title>Leagues</Title>
        {isAdmin ? <Link href='/leagues/admin'>Manage leagues</Link> : null}
        <FlexSpacer />
        <Link href='#' onClick={onHowItWorksClick}>
          How do leagues work?
        </Link>
      </TitleRow>

      {!isLoading && error ? <ErrorText>Error loading leagues</ErrorText> : null}

      {!isLoading || currentLeagues.length ? (
        <LeagueSection
          label='Currently running'
          leagues={currentLeagues}
          joinedLeagues={selfLeagues}
          type={LeagueSectionType.Current}
        />
      ) : undefined}
      {futureLeagues.length ? (
        <LeagueSection
          label='Accepting signups'
          leagues={futureLeagues}
          joinedLeagues={selfLeagues}
          type={LeagueSectionType.Future}
        />
      ) : null}
      {pastLeagues.length ? (
        <LeagueSection
          label='Finished'
          leagues={pastLeagues}
          joinedLeagues={selfLeagues}
          type={LeagueSectionType.Past}
        />
      ) : null}

      {isLoading ? <LoadingDotsArea /> : null}
    </ListRoot>
  )
}

const SectionRoot = styled.div`
  & + & {
    margin-top: 32px;
  }
`

const SectionLabel = styled.div`
  ${subtitle1};
  color: ${colorTextSecondary};
`

const SectionCards = styled.div`
  padding-top: 8px;

  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const EmptyText = styled.div`
  ${body1};
  color: ${colorTextFaint};
`

function LeagueSection({
  label,
  leagues,
  joinedLeagues,
  type,
}: {
  label: string
  leagues: Array<ReadonlyDeep<LeagueJson>>
  joinedLeagues: ReadonlyDeep<Map<ClientLeagueId, ClientLeagueUserJson>>
  type: LeagueSectionType
}) {
  const curDate = Date.now()

  return (
    <SectionRoot>
      <SectionLabel>{label}</SectionLabel>
      <SectionCards>
        {leagues.length ? (
          leagues.map(l => (
            <LeagueCard
              key={l.id}
              league={l}
              type={type}
              curDate={curDate}
              joined={joinedLeagues.has(l.id)}
            />
          ))
        ) : (
          <EmptyText>No matching leagues</EmptyText>
        )}
      </SectionCards>
    </SectionRoot>
  )
}

const LeagueCardRoot = styled(Card)`
  position: relative;
  width: 352px;
  padding: 0;

  display: flex;
  flex-direction: column;

  contain: content;
  cursor: pointer;
`

const LeagueName = styled.div`
  ${headline6};
  margin-top: 16px;
  padding: 0 16px;
`

const LeagueFormatAndDate = styled.div`
  ${caption};
  padding: 0 16px;
`

const LeagueDescription = styled.div`
  ${body1};
  margin-top: 16px;
  padding: 0 16px;

  display: -webkit-box;
  -webkit-box-orient: vertical;
  line-clamp: 3;
  -webkit-line-clamp: 3;
  overflow: hidden;
  text-overflow: ellipsis;
`

const LeagueActions = styled.div`
  padding: 16px 0 10px 16px;

  display: flex;
  justify-content: space-between;
`

const DateTooltip = styled(Tooltip)`
  display: inline-flex;
`

const JoinedIndicator = styled.div`
  ${body1};

  display: flex;
  align-items: center;
  gap: 4px;

  color: ${colorTextFaint};
`

function LeagueCard({
  league,
  type,
  curDate,
  joined,
}: {
  league: ReadonlyDeep<LeagueJson>
  type: LeagueSectionType
  curDate: number
  joined: boolean
}) {
  const onViewInfo = () => navigateToLeague(league.id, league)
  const [buttonProps, rippleRef] = useButtonState({ onClick: onViewInfo })

  let dateText: string
  let dateTooltip: string
  switch (type) {
    case LeagueSectionType.Current:
      dateText = `Ends ${narrowDuration.format(league.endAt, curDate)}`
      dateTooltip = longTimestamp.format(league.endAt)
      break
    case LeagueSectionType.Future:
      dateText = `Starts ${narrowDuration.format(league.startAt, curDate)}`
      dateTooltip = longTimestamp.format(league.startAt)
      break
    case LeagueSectionType.Past:
      dateText = `${monthDay.format(league.startAt)}\u2013${monthDay.format(league.endAt)}`
      dateTooltip = `${longTimestamp.format(league.startAt)}\u2013${longTimestamp.format(
        league.endAt,
      )}`
      break
    default:
      assertUnreachable(type)
  }

  return (
    <LeagueCardRoot {...buttonProps} tabIndex={0}>
      {league.imagePath ? <LeagueImage src={league.imagePath} /> : <LeaguePlaceholderImage />}
      <LeagueName>{league.name}</LeagueName>
      <LeagueFormatAndDate>
        {matchmakingTypeToLabel(league.matchmakingType)} ·{' '}
        <DateTooltip text={dateTooltip} position={'right'}>
          {dateText}
        </DateTooltip>
      </LeagueFormatAndDate>
      <LeagueDescription>{league.description}</LeagueDescription>
      <FlexSpacer />
      <LeagueActions>
        {joined ? (
          <JoinedIndicator>
            <CheckIcon />
            <span>Joined</span>
          </JoinedIndicator>
        ) : (
          <div />
        )}
        {/*
          NOTE(tec27): This intentionally doesn't have an onClick handler as it is handled by the
          card and having both would cause 2 navigations to occur.
        */}
        <TextButton label='View info' color='accent' />
      </LeagueActions>
      <Ripple ref={rippleRef} />
    </LeagueCardRoot>
  )
}
