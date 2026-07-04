import { ResultOf } from '@graphql-typed-document-node/core'
import { useState } from 'react'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { Route, Switch } from 'wouter'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { NullifyGamePointsRequest, NullifyGamePointsResponse } from '../../common/games/games'
import { apiUrl, urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { openSimpleDialog } from '../dialogs/action-creators'
import { graphql } from '../gql'
import { GameReportReason, GameReportResolution } from '../gql/graphql'
import { longTimestamp, NarrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { FilledButton, OutlinedButton } from '../material/button'
import { Card } from '../material/card'
import { CheckBox } from '../material/check-box'
import { TextField } from '../material/text-field'
import { push } from '../navigation/routing'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { watchReplayFromUrl } from '../replays/action-creators'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { selectableTextContainer } from '../styles/text-selection'
import { bodyLarge, bodyMedium, labelMedium, titleLarge, titleMedium } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { getGameResultsUrl } from './action-creators'

const AdminGameReportsListQuery = graphql(/* GraphQL */ `
  query AdminGameReportsList($filter: GameReportFilter, $first: Int, $after: String) {
    gameReports(filter: $filter, first: $first, after: $after) {
      edges {
        node {
          id
          reason
          details
          createdAt
          resolvedAt
          resolution
          reporter {
            id
          }
          reportedUser {
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`)

const AdminGameReportQuery = graphql(/* GraphQL */ `
  query AdminGameReport($id: UUID!) {
    gameReport(id: $id) {
      id
      reason
      details
      createdAt
      resolvedAt
      resolution
      resolutionNotes
      reporter {
        id
        name
      }
      reportedUser {
        id
        name
      }
      resolver {
        id
      }
      game {
        id
        config {
          __typename
          ... on GameConfigDataLobby {
            teams {
              isComputer
              user {
                id
                name
              }
            }
          }
          ... on GameConfigDataMatchmaking {
            teams {
              isComputer
              user {
                id
                name
              }
            }
          }
        }
      }
      replay {
        replayFileId
        hash
        url
      }
      reporterStats {
        total
        actioned
        dismissed
        abusive
        duplicate
        pending
      }
      reportedUserStats {
        total
        actioned
        dismissed
        abusive
        duplicate
        pending
      }
      siblingReports {
        id
        reason
        details
        createdAt
        resolvedAt
        resolution
        reporter {
          id
        }
      }
    }
  }
`)

const ResolveGameReportMutation = graphql(/* GraphQL */ `
  mutation ResolveGameReport($id: UUID!, $resolution: GameReportResolution!, $notes: String) {
    resolveGameReport(id: $id, resolution: $resolution, notes: $notes) {
      id
      resolvedAt
      resolution
      resolutionNotes
      resolver {
        id
      }
    }
  }
`)

const ResolveSiblingReportsMutation = graphql(/* GraphQL */ `
  mutation ResolveSiblingReports($id: UUID!, $resolution: GameReportResolution!, $notes: String) {
    resolveSiblingReports(id: $id, resolution: $resolution, notes: $notes)
  }
`)

function reasonToLabel(reason: GameReportReason): string {
  switch (reason) {
    case GameReportReason.Cheating:
      return 'Cheating or exploiting'
    case GameReportReason.Abandoning:
      return 'Left the game'
    case GameReportReason.Griefing:
      return 'Griefing'
    case GameReportReason.AbusiveChat:
      return 'Abusive chat'
    case GameReportReason.Other:
      return 'Other'
    default:
      return reason satisfies never
  }
}

/** Friendly messages for the `code`s the nullify-points endpoint can return. */
const REFUND_ERROR_MESSAGES: Record<string, string> = {
  gameNotFound: 'Game not found.',
  notCurrentSeason: 'Only current-season games can have their points refunded.',
  notRanked: 'This game has no ranked points to refund (it was not a ranked game).',
  notRefundable: 'None of the eligible players lost ranked points or bonus in this game.',
  invalidPlayers: 'The reported player did not participate in this game.',
  alreadyRefunded: "This game's points have already been refunded.",
}

function resolutionToLabel(resolution: GameReportResolution): string {
  switch (resolution) {
    case GameReportResolution.Actioned:
      return 'Actioned'
    case GameReportResolution.Dismissed:
      return 'Dismissed'
    case GameReportResolution.Abusive:
      return 'Abusive report'
    case GameReportResolution.Duplicate:
      return 'Duplicate'
    default:
      return resolution satisfies never
  }
}

/** "Pending" / the resolution label / "Resolved" for a report's resolved state. */
function resolvedStatusLabel(
  resolvedAt: unknown,
  resolution: GameReportResolution | null | undefined,
): string {
  if (!resolvedAt) {
    return 'Pending'
  }
  return resolution ? resolutionToLabel(resolution) : 'Resolved'
}

/**
 * Color tone for a resolved state in the incident overview. Only outcomes that reflect real action
 * (`Actioned`/`Duplicate`) read as positive; `Dismissed`/`Abusive` are muted so they don't look
 * "handled well" at a glance, and anything unresolved stays amber ("still pending").
 */
function siblingStatusTone(
  resolvedAt: unknown,
  resolution: GameReportResolution | null | undefined,
): 'positive' | 'muted' | 'pending' {
  if (!resolvedAt) {
    return 'pending'
  }
  return resolution === GameReportResolution.Actioned ||
    resolution === GameReportResolution.Duplicate
    ? 'positive'
    : 'muted'
}

const Content = styled.div`
  max-width: 960px;
  margin: 0 16px;
  overflow-y: auto;
`

const PageHeadline = styled.div`
  ${titleLarge};
`

const HeadlineAndButton = styled.div`
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  margin-bottom: 8px;
`

const ButtonWithCheckBox = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const NotFoundText = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
`

const RefundConfirmation = styled.div`
  margin-top: 12px;
  padding: 12px 16px;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const RefundWarning = styled.div`
  ${bodyMedium};
  margin-bottom: 12px;
  color: var(--theme-on-surface-variant);
`

const RefundListLabel = styled.div`
  ${labelMedium};
  margin-bottom: 8px;
  color: var(--theme-on-surface-variant);
`

const RefundPlayerList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
`

const RefundHint = styled.div`
  ${bodyMedium};
  margin-bottom: 12px;
  color: var(--theme-amber);
`

const SiblingList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const SiblingRow = styled.div`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: 12px;
`

const SiblingReporter = styled.div`
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const SiblingReason = styled.div`
  flex: 0 0 auto;
  color: var(--theme-on-surface-variant);
`

const SIBLING_TONE_COLORS = {
  positive: 'var(--theme-positive)',
  muted: 'var(--theme-on-surface-variant)',
  pending: 'var(--theme-amber)',
} as const

const SiblingStatus = styled.div<{ $tone: keyof typeof SIBLING_TONE_COLORS }>`
  ${labelMedium};
  flex: 0 0 auto;
  color: ${props => SIBLING_TONE_COLORS[props.$tone]};
`

const ReportTable = styled.div`
  width: 100%;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const TableRow = styled.div`
  height: 36px;

  display: flex;
  align-items: center;

  cursor: pointer;

  &:nth-child(even) {
    background-color: rgba(255, 255, 255, 0.04);
  }

  &:hover {
    background-color: rgba(255, 255, 255, 0.08);
  }
`

const TableHeader = styled(TableRow)`
  cursor: default;
  font-weight: 500;
`

const TableCell = styled.div`
  height: 100%;
  padding: 8px 16px;

  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const DateCell = styled(TableCell)`
  width: 112px;
  flex-grow: 0;
  flex-shrink: 0;
`

const UserCell = styled(TableCell)`
  width: 148px;
  flex-grow: 0;
  flex-shrink: 0;
`

const ReasonCell = styled(TableCell)`
  width: 160px;
  flex-grow: 0;
  flex-shrink: 0;
`

const DetailsCell = styled(TableCell)`
  flex-grow: 1;
`

const ResolvedCell = styled(TableCell)`
  width: 96px;
  flex-grow: 0;
  flex-shrink: 0;

  display: flex;
  justify-content: flex-end;
`

const LoadMoreRow = styled.div`
  display: flex;
  justify-content: center;
  padding: 12px;
`

export function AdminGameReports() {
  return (
    <Switch>
      <Route path='/admin/game-reports/:reportId' component={AdminGameReportView} />
      <Route component={AdminGameReportsList} />
    </Switch>
  )
}

const PAGE_SIZE = 50

function AdminGameReportsList() {
  const [includeResolved, setIncludeResolved] = useState(false)
  // One `after` cursor per loaded page (the first page has none). We page with cursors rather than
  // growing `first`, because the server clamps `first` to 100 — an ever-growing page size would
  // silently stop returning new rows past that.
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  // Bumped on refresh to re-mount the pages and force a fresh fetch.
  const [refreshToken, setRefreshToken] = useState(0)

  const resetToFirstPage = () => setPageCursors([null])

  return (
    <Content>
      <HeadlineAndButton>
        <PageHeadline>Game reports</PageHeadline>
        <ButtonWithCheckBox>
          <CheckBox
            label='Include resolved'
            checked={includeResolved}
            onChange={() => {
              setIncludeResolved(v => !v)
              resetToFirstPage()
            }}
          />
          <FilledButton
            label='Refresh'
            onClick={() => {
              resetToFirstPage()
              setRefreshToken(t => t + 1)
            }}
          />
        </ButtonWithCheckBox>
      </HeadlineAndButton>
      <ReportTable>
        <TableHeader>
          <DateCell>Date</DateCell>
          <UserCell>Reporter</UserCell>
          <UserCell>Reported</UserCell>
          <ReasonCell>Reason</ReasonCell>
          <DetailsCell>Details</DetailsCell>
          <ResolvedCell>Resolved</ResolvedCell>
        </TableHeader>
        {pageCursors.map((cursor, i) => (
          <GameReportsPage
            key={`${refreshToken}:${cursor ?? 'first'}`}
            includeResolved={includeResolved}
            after={cursor}
            isLastPage={i === pageCursors.length - 1}
            onLoadMore={endCursor => setPageCursors(prev => [...prev, endCursor])}
          />
        ))}
      </ReportTable>
    </Content>
  )
}

/**
 * A username inside a clickable table row. Clicks on the name (and clicks inside the profile
 * overlay it opens, which bubble here through the React tree) shouldn't trigger the row's
 * navigation.
 */
function RowUsername({ userId }: { userId: SbUserId }) {
  return (
    <span onClick={e => e.stopPropagation()}>
      <ConnectedUsername userId={userId} />
    </span>
  )
}

function GameReportsPage({
  includeResolved,
  after,
  isLastPage,
  onLoadMore,
}: {
  includeResolved: boolean
  after: string | null
  isLastPage: boolean
  onLoadMore: (endCursor: string) => void
}) {
  const [{ data, fetching, error }] = useQuery({
    query: AdminGameReportsListQuery,
    variables: { filter: { includeResolved }, first: PAGE_SIZE, after: after ?? undefined },
    // Show cached rows immediately but always revalidate, so Refresh (and returning from a
    // resolve) reflects server state.
    requestPolicy: 'cache-and-network',
  })

  const reports = data?.gameReports.edges.map(e => e.node) ?? []
  const pageInfo = data?.gameReports.pageInfo

  return (
    <>
      {reports.map(r => (
        <TableRow key={r.id} onClick={() => push(urlPath`/admin/game-reports/${r.id}`)}>
          <DateCell>
            <NarrowDuration to={new Date(r.createdAt)} />
          </DateCell>
          <UserCell>
            {r.reporter ? <RowUsername userId={r.reporter.id} /> : 'Unknown user'}
          </UserCell>
          <UserCell>
            {r.reportedUser ? <RowUsername userId={r.reportedUser.id} /> : 'Unknown user'}
          </UserCell>
          <ReasonCell>{reasonToLabel(r.reason)}</ReasonCell>
          <DetailsCell>{r.details}</DetailsCell>
          <ResolvedCell>{r.resolvedAt ? <MaterialIcon icon='check' /> : null}</ResolvedCell>
        </TableRow>
      ))}
      {fetching && !data ? <LoadingDotsArea /> : null}
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {isLastPage && pageInfo?.hasNextPage && pageInfo.endCursor ? (
        <LoadMoreRow>
          <OutlinedButton label='Load more' onClick={() => onLoadMore(pageInfo.endCursor!)} />
        </LoadMoreRow>
      ) : null}
    </>
  )
}

const DetailsRoot = styled.div`
  ${selectableTextContainer};

  padding-bottom: 24px;

  display: grid;
  grid-template-columns: minmax(0, 1fr) 304px;
  gap: 16px;
  align-items: start;
`

const CardColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SectionCard = styled(Card)`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const SectionLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const ReportHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`

const ReasonTitle = styled.div`
  ${titleLarge};
`

const SubmittedAt = styled.div`
  ${bodyMedium};
  margin-top: 2px;
  color: var(--theme-on-surface-variant);
`

const StatusChip = styled.div<{ $resolved: boolean }>`
  ${labelMedium};

  height: 24px;
  padding: 0 12px;

  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;

  border: 1px solid currentColor;
  border-radius: 12px;
  color: ${props => (props.$resolved ? 'var(--theme-positive)' : 'var(--theme-amber)')};
`

const DetailsValue = styled.pre`
  ${bodyLarge};

  margin: 0;
  padding: 4px 0 4px 12px;

  border-left: 2px solid var(--theme-outline-variant);
  font-family: inherit;
  overflow-wrap: anywhere;
  white-space: pre-line;
`

const ActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const MutedText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const ResolveTitle = styled.div`
  ${titleMedium};
`

const ResolvedHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const ResolvedIcon = styled(MaterialIcon)`
  color: var(--theme-positive);
`

const ResolvedOutcome = styled.div`
  ${titleMedium};
`

const RoleLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
`

const SideCardName = styled.div`
  ${titleMedium};
`

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
`

const StatTile = styled.div`
  ${containerStyles(ContainerLevel.Normal)};

  padding: 8px 4px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;

  border-radius: 4px;
`

const StatValue = styled.div<{ $color: string }>`
  ${titleMedium};
  color: ${props => props.$color};
`

const StatLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  /** Tint applied when the value is nonzero, for stats that are a signal for this user. */
  accent?: 'negative' | 'amber'
}) {
  let color = 'var(--theme-on-surface)'
  if (value === 0) {
    color = 'var(--theme-on-surface-variant)'
  } else if (accent === 'negative') {
    color = 'var(--theme-negative)'
  } else if (accent === 'amber') {
    color = 'var(--theme-amber)'
  }

  return (
    <StatTile>
      <StatValue $color={color}>{value}</StatValue>
      <StatLabel>{label}</StatLabel>
    </StatTile>
  )
}

interface GameReportUserStats {
  total: number
  actioned: number
  dismissed: number
  abusive: number
  duplicate: number
  pending: number
}

function ReportUserCard({
  role,
  statsLabel,
  user,
  stats,
  highlight,
}: {
  role: string
  statsLabel: string
  user: { id: SbUserId } | null | undefined
  stats: GameReportUserStats
  /**
   * The credibility signal for this user: prior actioned reports against a reported player, or
   * prior abusive reports from a reporter. Tinted when nonzero.
   */
  highlight: 'actioned' | 'abusive'
}) {
  return (
    <SectionCard>
      <div>
        <RoleLabel>{role}</RoleLabel>
        <SideCardName>
          {user ? <ConnectedUsername userId={user.id} /> : <MutedText>Unknown user</MutedText>}
        </SideCardName>
      </div>
      <Section>
        <SectionLabel>{statsLabel}</SectionLabel>
        <StatsGrid>
          <Stat label='Total' value={stats.total} />
          <Stat label='Pending' value={stats.pending} />
          <Stat
            label='Actioned'
            value={stats.actioned}
            accent={highlight === 'actioned' ? 'negative' : undefined}
          />
          <Stat label='Dismissed' value={stats.dismissed} />
          <Stat
            label='Abusive'
            value={stats.abusive}
            accent={highlight === 'abusive' ? 'amber' : undefined}
          />
          <Stat label='Duplicate' value={stats.duplicate} />
        </StatsGrid>
      </Section>
    </SectionCard>
  )
}

type AdminGameReport = NonNullable<ResultOf<typeof AdminGameReportQuery>['gameReport']>

function GameReportDetails({
  report,
  resolving,
  onResolve,
  resolvingSiblings,
  onResolveSiblings,
}: {
  report: AdminGameReport
  resolving: boolean
  onResolve: (resolution: GameReportResolution, notes: string | undefined) => void
  resolvingSiblings: boolean
  onResolveSiblings: (resolution: GameReportResolution) => void
}) {
  const dispatch = useAppDispatch()
  const [notes, setNotes] = useState('')
  const { game, replay, reporter, siblingReports } = report
  const pendingSiblings = siblingReports.filter(s => !s.resolvedAt)

  const onWatchReplay = () => {
    if (!replay || !game || !IS_ELECTRON) {
      return
    }
    dispatch(
      watchReplayFromUrl(
        { gameId: game.id, id: replay.replayFileId, url: replay.url, hash: replay.hash },
        game.id,
        {
          onSuccess: () => {},
          onError: err => {
            logger.error(`Error watching replay: ${err.stack ?? err}`)
            dispatch(
              openSimpleDialog(
                'Error loading replay',
                'There was a problem downloading or loading the replay.',
              ),
            )
          },
        },
      ),
    )
  }

  const resolve = (resolution: GameReportResolution) =>
    onResolve(resolution, notes.trim() ? notes.trim() : undefined)

  // The game's human players — candidates to refund.
  const participants = (game?.config.teams ?? [])
    .flat()
    .flatMap(p => (!p.isComputer && p.user ? [p.user] : []))

  const [refunding, setRefunding] = useState(false)
  const [confirmingRefund, setConfirmingRefund] = useState(false)
  // The players to refund (the checked set). Defaults to everyone except the reported player and is
  // reset each time the confirmation opens; the admin unchecks anyone else who was punished. The
  // endpoint takes the *punished* set, so we send everyone not checked here.
  const [refundedIds, setRefundedIds] = useState<ReadonlySet<SbUserId>>(new Set())
  const openRefundConfirmation = () => {
    const reportedId = report.reportedUser?.id
    setRefundedIds(new Set(participants.filter(p => p.id !== reportedId).map(p => p.id)))
    setConfirmingRefund(true)
  }
  const toggleRefunded = (userId: SbUserId) => {
    setRefundedIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }
  // Everyone left unchecked is treated as punished (excluded from the refund). The endpoint requires
  // at least one punished player, so refunding literally everyone isn't allowed.
  const punishedUserIds = participants.filter(p => !refundedIds.has(p.id)).map(p => p.id)
  const refundedCount = participants.length - punishedUserIds.length
  const canRefund = refundedCount > 0 && punishedUserIds.length > 0
  const onRefundPoints = () => {
    if (!game || !canRefund) {
      return
    }
    setConfirmingRefund(false)
    setRefunding(true)
    fetchJson<NullifyGamePointsResponse>(apiUrl`games/${game.id}/nullify-points`, {
      method: 'POST',
      body: encodeBodyAsParams<NullifyGamePointsRequest>({
        punishedUserIds,
      }),
    })
      .then(result => {
        setRefunding(false)
        dispatch(
          openSimpleDialog(
            'Points refunded',
            `Refunded points to ${result.refundedUsers.length} player(s) for this game.`,
          ),
        )
      })
      .catch(err => {
        setRefunding(false)
        const message =
          (isFetchError(err) && err.code && REFUND_ERROR_MESSAGES[err.code]) ||
          'There was a problem refunding points for this game.'
        dispatch(openSimpleDialog('Refund failed', message))
      })
  }

  const statusLabel = resolvedStatusLabel(report.resolvedAt, report.resolution)

  return (
    <DetailsRoot>
      <CardColumn>
        <SectionCard>
          <ReportHeader>
            <div>
              <ReasonTitle>{reasonToLabel(report.reason)}</ReasonTitle>
              <SubmittedAt>
                Submitted {longTimestamp.format(new Date(report.createdAt))}
              </SubmittedAt>
            </div>
            <StatusChip $resolved={!!report.resolvedAt}>
              <MaterialIcon icon={report.resolvedAt ? 'check_circle' : 'schedule'} size={16} />
              {statusLabel}
            </StatusChip>
          </ReportHeader>

          {report.details ? (
            <Section>
              <SectionLabel>Details</SectionLabel>
              <DetailsValue>{report.details}</DetailsValue>
            </Section>
          ) : null}

          <Section>
            <SectionLabel>Evidence</SectionLabel>
            {game || replay ? (
              <ActionRow>
                {game ? (
                  <OutlinedButton
                    label='View game'
                    iconStart={<MaterialIcon icon='sports_esports' />}
                    onClick={() => push(getGameResultsUrl(game.id))}
                  />
                ) : null}
                {replay ? (
                  <>
                    <OutlinedButton
                      label='Download replay'
                      iconStart={<MaterialIcon icon='download' />}
                      onClick={() => {
                        const a = document.createElement('a')
                        a.href = replay.url
                        a.target = '_blank'
                        a.click()
                      }}
                    />
                    {IS_ELECTRON ? (
                      <OutlinedButton
                        label='Watch replay'
                        iconStart={<MaterialIcon icon='play_circle' />}
                        onClick={onWatchReplay}
                      />
                    ) : null}
                  </>
                ) : null}
              </ActionRow>
            ) : null}
            {!game ? <MutedText>Game record not available.</MutedText> : null}
            {!replay ? <MutedText>No replay available.</MutedText> : null}
          </Section>
        </SectionCard>

        <SectionCard>
          {report.resolvedAt ? (
            <>
              <ResolvedHeader>
                <ResolvedIcon icon='check_circle' size={24} />
                <div>
                  <ResolvedOutcome>
                    {report.resolution ? resolutionToLabel(report.resolution) : 'Resolved'}
                  </ResolvedOutcome>
                  <MutedText>
                    Resolved by{' '}
                    {report.resolver ? (
                      <ConnectedUsername userId={report.resolver.id} />
                    ) : (
                      'unknown user'
                    )}{' '}
                    · {longTimestamp.format(new Date(report.resolvedAt))}
                  </MutedText>
                </div>
              </ResolvedHeader>
              {report.resolutionNotes ? (
                <Section>
                  <SectionLabel>Notes</SectionLabel>
                  <DetailsValue>{report.resolutionNotes}</DetailsValue>
                </Section>
              ) : null}
              {reporter || game ? (
                <ActionRow>
                  {reporter ? (
                    <OutlinedButton
                      label='Restrict this reporter'
                      iconStart={<MaterialIcon icon='gavel' />}
                      onClick={() =>
                        push(urlPath`/users/${reporter.id}/${reporter.name}/admin/punishments`)
                      }
                    />
                  ) : null}
                  {game &&
                  report.reportedUser &&
                  report.resolution === GameReportResolution.Actioned ? (
                    <OutlinedButton
                      label='Refund game points'
                      iconStart={<MaterialIcon icon='paid' />}
                      disabled={refunding || confirmingRefund}
                      onClick={openRefundConfirmation}
                    />
                  ) : null}
                </ActionRow>
              ) : null}
              {confirmingRefund && game ? (
                <RefundConfirmation>
                  <RefundWarning>
                    Checked players get the ranked and league points they lost in this game back.
                    The reported player is unchecked by default — uncheck anyone else who was
                    punished. This can't be undone.
                  </RefundWarning>
                  <RefundListLabel>Players to refund</RefundListLabel>
                  <RefundPlayerList>
                    {participants.map(p => (
                      <CheckBox
                        key={p.id}
                        label={p.name}
                        checked={refundedIds.has(p.id)}
                        onChange={() => toggleRefunded(p.id)}
                        disabled={refunding}
                      />
                    ))}
                  </RefundPlayerList>
                  {refundedCount > 0 && punishedUserIds.length === 0 ? (
                    <RefundHint>
                      Leave at least one player unchecked — a refund must exclude at least one
                      punished player.
                    </RefundHint>
                  ) : null}
                  <ActionRow>
                    <OutlinedButton
                      label='Cancel'
                      disabled={refunding}
                      onClick={() => setConfirmingRefund(false)}
                    />
                    <FilledButton
                      label='Refund points'
                      disabled={refunding || !canRefund}
                      onClick={onRefundPoints}
                    />
                  </ActionRow>
                </RefundConfirmation>
              ) : null}
            </>
          ) : (
            <>
              <ResolveTitle>Resolve this report</ResolveTitle>
              <TextField
                value={notes}
                onChange={e => setNotes(e.target.value)}
                label='Notes (optional)'
                allowErrors={false}
                floatingLabel={true}
                multiline={true}
                rows={2}
                maxRows={6}
                disabled={resolving}
              />
              <ActionRow>
                <FilledButton
                  label='Actioned'
                  disabled={resolving}
                  onClick={() => resolve(GameReportResolution.Actioned)}
                />
                <OutlinedButton
                  label='Dismissed'
                  disabled={resolving}
                  onClick={() => resolve(GameReportResolution.Dismissed)}
                />
                <OutlinedButton
                  label='Abusive report'
                  disabled={resolving}
                  onClick={() => resolve(GameReportResolution.Abusive)}
                />
                <OutlinedButton
                  label='Duplicate'
                  disabled={resolving}
                  onClick={() => resolve(GameReportResolution.Duplicate)}
                />
              </ActionRow>
            </>
          )}
        </SectionCard>

        {siblingReports.length ? (
          <SectionCard>
            <SectionLabel>
              Other reports for this game against this player ({siblingReports.length})
            </SectionLabel>
            <SiblingList>
              {siblingReports.map(s => (
                <SiblingRow key={s.id}>
                  <SiblingReporter>
                    {s.reporter ? <ConnectedUsername userId={s.reporter.id} /> : 'unknown user'}
                  </SiblingReporter>
                  <SiblingReason>{reasonToLabel(s.reason)}</SiblingReason>
                  <SiblingStatus $tone={siblingStatusTone(s.resolvedAt, s.resolution)}>
                    {resolvedStatusLabel(s.resolvedAt, s.resolution)}
                  </SiblingStatus>
                </SiblingRow>
              ))}
            </SiblingList>
            {pendingSiblings.length ? (
              <ActionRow>
                <OutlinedButton
                  label={`Resolve ${pendingSiblings.length} pending as Duplicate`}
                  iconStart={<MaterialIcon icon='content_copy' />}
                  disabled={resolvingSiblings}
                  onClick={() => onResolveSiblings(GameReportResolution.Duplicate)}
                />
              </ActionRow>
            ) : null}
          </SectionCard>
        ) : null}
      </CardColumn>

      <CardColumn>
        <ReportUserCard
          role='Reported player'
          statsLabel='Reports received'
          user={report.reportedUser}
          stats={report.reportedUserStats}
          highlight='actioned'
        />
        <ReportUserCard
          role='Reporter'
          statsLabel='Reports filed'
          user={reporter}
          stats={report.reporterStats}
          highlight='abusive'
        />
      </CardColumn>
    </DetailsRoot>
  )
}

function AdminGameReportView({ params: { reportId } }: { params: { reportId: string } }) {
  const [{ data, fetching, error }, reexecute] = useQuery({
    query: AdminGameReportQuery,
    variables: { id: reportId },
  })
  const [{ fetching: resolving, error: resolveError }, resolveGameReport] =
    useMutation(ResolveGameReportMutation)
  const [{ fetching: resolvingSiblings, error: resolveSiblingsError }, resolveSiblingReports] =
    useMutation(ResolveSiblingReportsMutation)

  const report = data?.gameReport

  const onResolve = (resolution: GameReportResolution, notes: string | undefined) => {
    resolveGameReport({ id: reportId, resolution, notes })
      .then(result => {
        if (!result.error) {
          reexecute({ requestPolicy: 'network-only' })
        }
      })
      .catch(swallowNonBuiltins)
  }

  const onResolveSiblings = (resolution: GameReportResolution) => {
    resolveSiblingReports({ id: reportId, resolution, notes: undefined })
      .then(result => {
        if (!result.error) {
          reexecute({ requestPolicy: 'network-only' })
        }
      })
      .catch(swallowNonBuiltins)
  }

  return (
    <Content>
      <HeadlineAndButton>
        <PageHeadline>Game report</PageHeadline>
        {fetching ? <LoadingDotsArea /> : null}
        <FilledButton
          label='Refresh'
          onClick={() => reexecute({ requestPolicy: 'network-only' })}
        />
      </HeadlineAndButton>
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {resolveError ? <ErrorText>Error resolving: {resolveError.message}</ErrorText> : null}
      {resolveSiblingsError ? (
        <ErrorText>Error resolving pending reports: {resolveSiblingsError.message}</ErrorText>
      ) : null}
      {report ? (
        <GameReportDetails
          report={report}
          resolving={resolving}
          onResolve={onResolve}
          resolvingSiblings={resolvingSiblings}
          onResolveSiblings={onResolveSiblings}
        />
      ) : null}
      {!report && !fetching && !error ? (
        // The detail view is deep-linkable, and a stale/bad id resolves to a null report rather
        // than an error, so show explicit feedback instead of an empty page.
        <NotFoundText>No report found with this ID.</NotFoundText>
      ) : null}
    </Content>
  )
}
