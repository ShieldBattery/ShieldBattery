import React, { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { TableVirtuoso } from 'react-virtuoso'
import slug from 'slug'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { Link, useRoute } from 'wouter'
import { assertUnreachable } from '../../common/assert-unreachable'
import {
  ClientLeagueUserJson,
  LeagueErrorCode,
  LeagueId,
  LeagueJson,
} from '../../common/leagues/leagues'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { RaceChar, raceCharToLabel } from '../../common/races'
import { urlPath } from '../../common/urls'
import { useTrackPageView } from '../analytics/analytics'
import { redirectToLogin, useIsLoggedIn } from '../auth/auth-utils'
import { ConnectedAvatar } from '../avatars/avatar'
import { longTimestamp, monthDay, narrowDuration } from '../i18n/date-formats'
import logger from '../logging/logger'
import { Markdown } from '../markdown/markdown'
import { FilledButton } from '../material/button'
import { useScrollIndicatorState } from '../material/scroll-indicator'
import { elevationPlus2 } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip } from '../material/tooltip'
import { CopyLinkButton } from '../navigation/copy-link-button'
import { ExternalLink } from '../navigation/external-link'
import { replace } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { getRaceColor } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import {
  bodyLarge,
  headlineLarge,
  labelMedium,
  singleLine,
  titleLarge,
  titleMedium,
} from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import {
  correctSlugForLeague,
  getLeagueById,
  getLeagueLeaderboard,
  joinLeague,
  navigateToLeague,
} from './action-creators'
import { ALL_DETAILS_SUB_PAGES, DetailsSubPage } from './details-sub-page'
import { LeagueBadge } from './league-badge'
import { LeagueImage, LeaguePlaceholderImage } from './league-image'
import { fromRouteLeagueId, makeRouteLeagueId } from './route-league-id'

const PageRoot = styled.div`
  position: relative;
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;

  overflow-x: hidden;
  overflow-y: auto;
`

export function LeagueDetailsPage() {
  const [containerElem, setContainerElem] = useState<HTMLDivElement | null>(null)
  const [match, params] = useRoute('/leagues/:routeId/:slugStr?/:subPage?')
  // TODO(tec27): Remove explicit typecast here once https://github.com/lukeed/regexparam/issues/31
  // is fixed and wouter includes the fix
  const { routeId, slugStr } = (params ?? {}) as { routeId?: string; slugStr?: string }
  const id = routeId ? fromRouteLeagueId(makeRouteLeagueId(routeId)) : undefined
  const leagueName = useAppSelector(s => (id ? s.leagues.byId.get(id)?.name : undefined))

  const subPage =
    params?.subPage && ALL_DETAILS_SUB_PAGES.includes(params.subPage as DetailsSubPage)
      ? (params.subPage as DetailsSubPage)
      : undefined

  useTrackPageView(urlPath`/leagues/${routeId}/${subPage ?? ''}`)

  useEffect(() => {
    if (match && leagueName && slug(leagueName) !== slugStr) {
      correctSlugForLeague(id!, leagueName, subPage)
    }
  }, [match, id, slugStr, leagueName, subPage])

  if (!match) {
    return null
  }

  return (
    <PageRoot ref={setContainerElem}>
      <LeagueDetails id={id!} subPage={subPage} container={containerElem} />
    </PageRoot>
  )
}

const DetailsRoot = styled.div`
  width: 100%;
  max-width: 752px;
  height: 100%;
  min-height: min-content;
  margin-top: 24px;
  padding: 0 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const InfoRoot = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
`

const InfoBadge = styled(LeagueBadge)`
  width: 80px;
  height: 80px;
  flex-grow: 0;
  flex-shrink: 0;
`

const TitleAndSummary = styled.div`
  flex-grow: 1;
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const Title = styled.div`
  ${headlineLarge};
`

const SummaryRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 32px;
`

const FormatAndDate = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
  flex-shrink: 0;
`

const DateTooltip = styled(Tooltip)`
  display: inline-flex;
`

const LeagueLink = styled(ExternalLink)`
  ${bodyLarge};
  ${singleLine};
  min-width: 80px;
  text-align: right;
`

const TabsAndJoin = styled.div`
  display: flex;
  justify-content: space-between;
`

const InfoSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;

  & + & {
    margin-top: 16px;
  }
`

const InfoSectionHeader = styled.div`
  ${titleLarge};
`

const LeagueImageContainer = styled.div`
  flex-shrink: 0;
`

const ErrorLayout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

export interface LeagueDetailsProps {
  id: LeagueId
  subPage?: DetailsSubPage
  container: HTMLElement | null
}

export function LeagueDetails({ id, subPage, container }: LeagueDetailsProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<Error>()

  const isLoggedIn = useIsLoggedIn()
  const league = useAppSelector(s => s.leagues.byId.get(id))
  const selfLeagueUser = useAppSelector(s => s.leagues.selfLeagues.get(id))

  const [isJoining, setIsJoining] = useState(false)
  const onJoinClick = useStableCallback(() => {
    if (!isLoggedIn) {
      redirectToLogin()
      return
    }

    setIsJoining(true)

    dispatch(
      joinLeague(id, {
        onSuccess() {
          setIsJoining(false)
          snackbarController.showSnackbar(t('leagues.leagueDetails.leagueJoined', 'League joined'))
        },
        onError(err) {
          setIsJoining(false)
          if (isFetchError(err) && err.code === LeagueErrorCode.AlreadyEnded) {
            snackbarController.showSnackbar(
              t(
                'leagues.leagueDetails.leagueEndedError',
                "Couldn't join because the league has already ended",
              ),
            )
          } else {
            snackbarController.showSnackbar(
              t('leagues.leagueDetails.joinError', {
                defaultValue: "Couldn't join league: {{errorMessage}}",
                errorMessage: isFetchError(err) ? err.statusText : err.message,
              }),
            )
          }
          logger.error(`Error joining league: ${String(err.stack ?? err)}`)
        },
      }),
    )
  })

  const onTabChange = useStableCallback((subPage: DetailsSubPage) => {
    navigateToLeague(id, league, subPage, replace)
  })

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    setError(undefined)
    setIsFetching(true)

    dispatch(
      getLeagueById(id, {
        signal,
        onSuccess(res) {
          setIsFetching(false)
          setError(undefined)
        },
        onError(err) {
          setIsFetching(false)
          setError(err)
          logger.error(`Error loading league details: ${String(err.stack ?? err)}`)
        },
      }),
    )

    return () => controller.abort()
  }, [id, dispatch])

  if (error) {
    if (isFetchError(error) && error.code === LeagueErrorCode.NotFound) {
      return (
        <ErrorLayout>
          <ErrorText>{t('leagues.leagueDetails.notFound', 'League not found')}</ErrorText>
          <Link href='/leagues'>{t('leagues.leagueDetails.goBack', 'Go back to list')}</Link>
        </ErrorLayout>
      )
    } else {
      return (
        <ErrorLayout>
          <ErrorText>
            <Trans t={t} i18nKey='leagues.leagueDetails.retrieveError'>
              There was an error retrieving this league:{' '}
              {{ errorMessage: (error as any).statusText ?? error.toString() }}
            </Trans>
          </ErrorText>

          <Link href='/leagues'>{t('leagues.leagueDetails.goBack', 'Go back to list')}</Link>
        </ErrorLayout>
      )
    }
  } else if (!league) {
    return <LoadingDotsArea />
  }

  const curTime = Date.now()
  const isJoinable = !selfLeagueUser && league.endAt > curTime
  const isRunningOrEnded = league.startAt <= curTime

  const activeTab = subPage ?? DetailsSubPage.Info

  let content: React.ReactNode
  switch (activeTab) {
    case DetailsSubPage.Info:
      content = <LeagueDetailsInfo league={league} />
      break
    case DetailsSubPage.Leaderboard:
      content = <Leaderboard league={league} container={container} />
      break
    default:
      assertUnreachable(activeTab)
  }

  return (
    <DetailsRoot>
      <meta property='og:title' content={`ShieldBattery League - ${league.name}`} />
      <meta property='og:description' content={league.description} />
      {league.imagePath ? <meta property='og:image' content={league.imagePath} /> : undefined}
      <meta name='twitter:title' content={`ShieldBattery League - ${league.name}`} />
      <meta name='twitter:description' content={league.description} />
      {league.imagePath ? <meta name='twitter:image' content={league.imagePath} /> : undefined}

      <LeagueDetailsHeader league={league} />
      <TabsAndJoin>
        <Tabs activeTab={activeTab} onChange={onTabChange}>
          <TabItem value={DetailsSubPage.Info} text={t('leagues.leagueDetails.info', 'Info')} />
          {isRunningOrEnded ? (
            <TabItem
              value={DetailsSubPage.Leaderboard}
              text={t('leagues.leagueDetails.leaderboard', 'Leaderboard')}
            />
          ) : (
            <></>
          )}
        </Tabs>
        {(isJoinable || selfLeagueUser) && (!isFetching || selfLeagueUser) ? (
          <FilledButton
            label={
              selfLeagueUser
                ? t('leagues.leagueDetails.joined', 'Joined')
                : t('common.actions.join', 'Join')
            }
            disabled={!!selfLeagueUser || isJoining}
            onClick={onJoinClick}
          />
        ) : undefined}
      </TabsAndJoin>
      {content}
    </DetailsRoot>
  )
}

export interface LeagueDetailsHeaderProps {
  league: ReadonlyDeep<LeagueJson>
}

export function LeagueDetailsHeader({ league }: LeagueDetailsHeaderProps) {
  const { t } = useTranslation()
  // TODO(tec27): Handle cases where year differs to smartly show that info
  const dateText = t('leagues.leagueDetails.dateText', {
    defaultValue: `{{startDate}} to {{endDate}}`,
    startDate: monthDay.format(league.startAt),
    endDate: monthDay.format(league.endAt),
  })
  const dateTooltip = t('leagues.leagueDetails.dateText', {
    defaultValue: `{{startDate}} to {{endDate}}`,
    startDate: longTimestamp.format(league.startAt),
    endDate: longTimestamp.format(league.endAt),
  })

  return (
    <InfoRoot>
      <InfoBadge league={league} />
      <TitleAndSummary>
        <TitleRow>
          <Title>{league.name}</Title>
          <CopyLinkButton
            tooltipPosition='right'
            startingText={t('leagues.leagueDetails.copyLink', 'Copy link to league')}
          />
        </TitleRow>
        <SummaryRow>
          <FormatAndDate>
            {matchmakingTypeToLabel(league.matchmakingType, t)} ·{' '}
            <DateTooltip text={dateTooltip} position={'right'}>
              {dateText}
            </DateTooltip>
          </FormatAndDate>
          <FlexSpacer />
          {league.link ? <LeagueLink href={league.link}>{league.link}</LeagueLink> : undefined}
        </SummaryRow>
      </TitleAndSummary>
    </InfoRoot>
  )
}

export interface LeagueDetailsInfoProps {
  league: ReadonlyDeep<LeagueJson>
}

export function LeagueDetailsInfo({ league }: LeagueDetailsInfoProps) {
  const { t } = useTranslation()
  return (
    <>
      <LeagueImageContainer>
        {league.imagePath ? <LeagueImage src={league.imagePath} /> : <LeaguePlaceholderImage />}
      </LeagueImageContainer>
      <InfoSection>
        <InfoSectionHeader>{t('leagues.leagueDetails.about', 'About')}</InfoSectionHeader>
        <div>{league.description}</div>
      </InfoSection>
      {league.rulesAndInfo ? (
        <InfoSection>
          <InfoSectionHeader>
            {t('leagues.leagueDetails.rulesAndInfo', 'Rules and info')}
          </InfoSectionHeader>
          <div>
            <Markdown source={league.rulesAndInfo} />
          </div>
        </InfoSection>
      ) : undefined}
    </>
  )
}

const TableBody = React.forwardRef((props, ref: React.ForwardedRef<any>) => (
  <div ref={ref} {...props} />
))

const TableRow = styled.div``

const FillerRow = styled.div.attrs<{ height: number }>(props => ({
  style: { height: `${props.height}px` },
}))<{ height: number }>``

const HEADER_STUCK_CLASS = 'sb-leaderboard-table-sticky-header'

const LeaderboardRoot = styled.div`
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
  contain: content;
`

const LeaderboardHeaderRow = styled.div`
  ${labelMedium};
  width: 100%;
  height: 48px;
  position: sticky !important;
  top: 0;
  --sb-leaderboard-row-height: 48px;

  display: flex;
  align-items: center;

  background-color: var(--theme-container-low);
  color: var(--theme-on-surface-variant);
  contain: content;

  .${HEADER_STUCK_CLASS} & {
    ${elevationPlus2};
    border-bottom: 1px solid var(--theme-outline-variant);
  }
`

const LeaderboardRowRoot = styled.div`
  ${bodyLarge};
  position: relative;
  width: 100%;
  height: 72px;
  --sb-leaderboard-row-height: 72px;

  display: flex;
  align-items: center;

  &::after {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    content: '';
    pointer-events: none;
  }

  &:hover {
    &::after {
      background-color: rgb(from var(--theme-on-surface) r g b / 0.04);
    }
  }
`

const BaseCell = styled.div`
  height: var(--sb-leaderboard-row-height);
  display: flex;
  align-items: center;
`

const NumericCell = styled(BaseCell)`
  justify-content: flex-end;
  text-align: right;
`

const TextCell = styled(BaseCell)`
  justify-content: flex-start;
  text-align: left;
`

const RankCell = styled(NumericCell)`
  width: 80px;
  padding: 0 16px;
`

const PlayerCell = styled(TextCell)`
  width: 176px;
  padding: 0 16px;

  flex-grow: 1;
`

const PointsCell = styled(NumericCell)`
  width: 56px;
`

const WinLossCell = styled(NumericCell)`
  width: 112px;
`

const LastPlayedCell = styled(NumericCell)`
  width: 156px;
  padding: 0 16px 0 32px;
  color: var(--theme-on-surface-variant);
`

const LeaderboardError = styled(ErrorText)`
  padding: 16px;
  text-align: center;
`

const EmptyText = styled.div`
  ${bodyLarge};
  padding: 16px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const FooterSpacing = styled.div`
  height: 12px;
`

function LeaderboardAndMargin({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <LeaderboardRoot>{children}</LeaderboardRoot>
      <FooterSpacing />
    </>
  )
}

function LeaderboardHeader() {
  const { t } = useTranslation()
  return (
    <>
      <RankCell>{t('leagues.leagueDetails.leaderBoardHeader.rank', 'Rank')}</RankCell>
      <PlayerCell>{t('leagues.leagueDetails.leaderBoardHeader.player', 'Player')}</PlayerCell>
      <PointsCell>{t('leagues.leagueDetails.leaderBoardHeader.points', 'Points')}</PointsCell>
      <WinLossCell>{t('leagues.leagueDetails.leaderBoardHeader.winLoss', 'Win/loss')}</WinLossCell>
      <LastPlayedCell>
        {t('leagues.leagueDetails.leaderBoardHeader.lastPlayed', 'Last played')}
      </LastPlayedCell>
    </>
  )
}

interface LeaderboardEntry {
  rank: number
  leagueUser: ReadonlyDeep<ClientLeagueUserJson>
}

function Leaderboard({
  league,
  container,
}: {
  league: ReadonlyDeep<LeagueJson>
  container: HTMLElement | null
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const leaderboard = useAppSelector(s => s.leagues.leaderboard.get(league.id))
  const leaderboardUsers = useAppSelector(s => s.leagues.leaderboardUsers.get(league.id))

  const [error, setError] = useState<Error | undefined>(undefined)

  const id = league.id
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    setError(undefined)

    dispatch(
      getLeagueLeaderboard(id, {
        signal,
        onSuccess(res) {
          setError(undefined)
        },
        onError(err) {
          setError(err)
          logger.error(`Error loading leaderboard: ${String(err.stack ?? err)}`)
        },
      }),
    )

    return () => controller.abort()
  }, [id, dispatch])

  const [leaderboardEntries, curTime] = useMemo(() => {
    const result: LeaderboardEntry[] = []
    if (!leaderboard || !leaderboardUsers) {
      return [result, Date.now()]
    }

    let curRank = 1

    for (const userId of leaderboard) {
      const leagueUser = leaderboardUsers.get(userId)!
      const rank =
        result.length && result.at(-1)!.leagueUser.points > leagueUser.points ? ++curRank : curRank
      result.push({ rank, leagueUser })
    }

    return [result, Date.now()]
  }, [leaderboard, leaderboardUsers])

  const [isHeaderUnstuck, , topHeaderNode, bottomHeaderNode] = useScrollIndicatorState({
    refreshToken: leaderboard,
  })

  const renderRow = useStableCallback((_index: number, entry: LeaderboardEntry) => (
    <LeaderboardRow entry={entry} curTime={curTime} />
  ))

  return (
    <>
      {error ? (
        <LeaderboardError>
          <Trans t={t} i18nKey='leagues.leagueDetails.leaderboardError'>
            There was a problem retrieving the leaderboard:{' '}
            {{ errorMessage: isFetchError(error) ? error.statusText : error.message }}
          </Trans>
        </LeaderboardError>
      ) : undefined}
      {topHeaderNode}
      {leaderboard ? (
        <>
          {container && leaderboardEntries.length ? (
            <TableVirtuoso
              className={isHeaderUnstuck ? '' : HEADER_STUCK_CLASS}
              customScrollParent={container}
              fixedHeaderContent={LeaderboardHeader}
              components={{
                Table: LeaderboardAndMargin,
                // NOTE(tec27): virtuoso expects a table section here, even though it doesn't
                // *really* care. Because of that though, the typings clash with what is
                // acceptable for `ref` props, so we cast to `any` to get past that error
                TableHead: LeaderboardHeaderRow as any,
                TableBody,
                TableRow,
                FillerRow,
              }}
              data={leaderboardEntries}
              itemContent={renderRow}
            />
          ) : (
            <EmptyText>{t('leagues.leagueDetails.noPlayers', 'No matching players.')}</EmptyText>
          )}
        </>
      ) : (
        <LeaderboardRoot>
          <LoadingDotsArea />
        </LeaderboardRoot>
      )}
      {bottomHeaderNode}
    </>
  )
}

const StyledAvatar = styled(ConnectedAvatar)`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  margin-right: 16px;
`

const PlayerNameAndRace = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`

const PlayerName = styled(ConnectedUsername)`
  ${titleMedium};
  ${singleLine};
`

const PlayerRace = styled.div<{ $race: RaceChar }>`
  ${labelMedium};
  color: ${props => getRaceColor(props.$race)};
`

const LeaderboardRow = React.memo(
  ({ entry: { rank, leagueUser }, curTime }: { entry: LeaderboardEntry; curTime: number }) => {
    const { t } = useTranslation()

    const raceStats: Array<[number, RaceChar]> = [
      [leagueUser.pWins + leagueUser.pLosses, 'p'],
      [leagueUser.tWins + leagueUser.tLosses, 't'],
      [leagueUser.zWins + leagueUser.zLosses, 'z'],
      [leagueUser.rWins + leagueUser.rLosses, 'r'],
    ]
    raceStats.sort((a, b) => b[0] - a[0])
    const mostPlayedRace = raceStats[0][1]

    return (
      <LeaderboardRowRoot key={leagueUser.userId}>
        <RankCell>{rank}</RankCell>
        <PlayerCell>
          <StyledAvatar userId={leagueUser.userId} />
          <PlayerNameAndRace>
            <PlayerName userId={leagueUser.userId} />
            <PlayerRace $race={mostPlayedRace}>{raceCharToLabel(mostPlayedRace, t)}</PlayerRace>
          </PlayerNameAndRace>
        </PlayerCell>
        <PointsCell>{Math.round(leagueUser.points)}</PointsCell>
        <WinLossCell>
          {leagueUser.wins} &ndash; {leagueUser.losses}
        </WinLossCell>
        <LastPlayedCell>
          <Tooltip text={longTimestamp.format(leagueUser.lastPlayedDate)}>
            {leagueUser.lastPlayedDate
              ? narrowDuration.format(leagueUser.lastPlayedDate, curTime)
              : undefined}
          </Tooltip>
        </LastPlayedCell>
      </LeaderboardRowRoot>
    )
  },
)
