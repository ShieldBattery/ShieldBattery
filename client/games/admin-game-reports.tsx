import { useState } from 'react'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { Link, Route, Switch } from 'wouter'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { urlPath } from '../../common/urls'
import { openSimpleDialog } from '../dialogs/action-creators'
import { graphql } from '../gql'
import { GameReportReason, GameReportResolution } from '../gql/graphql'
import { longTimestamp, NarrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { FilledButton, OutlinedButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { TextField } from '../material/text-field'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { watchReplayFromUrl } from '../replays/action-creators'
import { selectableTextContainer } from '../styles/text-selection'
import { bodyLarge, titleLarge, titleMedium } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'

const AdminGameReportsListQuery = graphql(/* GraphQL */ `
  query AdminGameReportsList($filter: GameReportFilter, $first: Int) {
    gameReports(filter: $filter, first: $first) {
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

const LoadMore = styled(OutlinedButton)`
  margin: 12px 0;
`

export function AdminGameReports() {
  return (
    <Switch>
      <Route path='/admin/game-reports/:reportId' component={AdminGameReportView} />
      <Route component={AdminGameReportsList} />
    </Switch>
  )
}

function AdminGameReportsList() {
  const [includeResolved, setIncludeResolved] = useState(false)
  const [pageSize, setPageSize] = useState(50)

  const [{ data, fetching, error }, reexecute] = useQuery({
    query: AdminGameReportsListQuery,
    variables: { filter: { includeResolved }, first: pageSize },
  })

  const reports = data?.gameReports.edges.map(e => e.node) ?? []
  const hasNextPage = data?.gameReports.pageInfo.hasNextPage ?? false

  return (
    <Content>
      <HeadlineAndButton>
        <PageHeadline>Game reports</PageHeadline>
        {fetching ? <LoadingDotsArea /> : null}
        <ButtonWithCheckBox>
          <CheckBox
            label='Include resolved'
            checked={includeResolved}
            onChange={() => setIncludeResolved(!includeResolved)}
          />
          <FilledButton
            label='Refresh'
            onClick={() => reexecute({ requestPolicy: 'network-only' })}
          />
        </ButtonWithCheckBox>
      </HeadlineAndButton>
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      <ReportTable>
        <TableHeader>
          <DateCell>Date</DateCell>
          <UserCell>Reporter</UserCell>
          <UserCell>Reported</UserCell>
          <ReasonCell>Reason</ReasonCell>
          <DetailsCell>Details</DetailsCell>
          <ResolvedCell>Resolved</ResolvedCell>
        </TableHeader>
        {reports.map(r => (
          <TableRow key={r.id} onClick={() => push(urlPath`/admin/game-reports/${r.id}`)}>
            <DateCell>
              <NarrowDuration to={new Date(r.createdAt)} />
            </DateCell>
            <UserCell>
              <ConnectedUsername userId={r.reporter!.id} />
            </UserCell>
            <UserCell>
              <ConnectedUsername userId={r.reportedUser!.id} />
            </UserCell>
            <ReasonCell>{reasonToLabel(r.reason)}</ReasonCell>
            <DetailsCell>{r.details}</DetailsCell>
            <ResolvedCell>{r.resolvedAt ? <MaterialIcon icon='check' /> : null}</ResolvedCell>
          </TableRow>
        ))}
      </ReportTable>
      {hasNextPage ? (
        <LoadMore label='Load more' onClick={() => setPageSize(pageSize + 50)} />
      ) : null}
    </Content>
  )
}

const Items = styled.div`
  ${selectableTextContainer};
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Item = styled.div`
  justify-content: flex-start;
  display: flex;
  gap: 16px;
`

const ItemLabel = styled.div`
  ${titleMedium};
  width: 160px;
  flex: 0 0 auto;
  text-align: right;
`

const ItemValue = styled.div`
  ${bodyLarge};
`

const DetailsValue = styled.pre`
  ${bodyLarge};

  margin: 0;
  padding: 8px 0 8px 8px;

  border-left: 1px solid var(--theme-outline-variant);
  font-family: inherit;
  white-space: pre-line;
`

const ResolveActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
`

interface GameReportUserStats {
  total: number
  actioned: number
  dismissed: number
  abusive: number
  duplicate: number
  pending: number
}

function formatStats(stats: GameReportUserStats): string {
  return (
    `${stats.total} total — ${stats.actioned} actioned, ${stats.dismissed} dismissed, ` +
    `${stats.abusive} abusive, ${stats.duplicate} duplicate, ${stats.pending} pending`
  )
}

function AdminGameReportView({ params: { reportId } }: { params: { reportId: string } }) {
  const dispatch = useAppDispatch()
  const [notes, setNotes] = useState('')

  const [{ data, fetching, error }, reexecute] = useQuery({
    query: AdminGameReportQuery,
    variables: { id: reportId },
  })
  const [{ fetching: resolving, error: resolveError }, resolveGameReport] =
    useMutation(ResolveGameReportMutation)

  const report = data?.gameReport

  const onResolve = (resolution: GameReportResolution) => {
    resolveGameReport({ id: reportId, resolution, notes: notes.trim() ? notes.trim() : undefined })
      .then(result => {
        if (!result.error) {
          reexecute({ requestPolicy: 'network-only' })
        }
      })
      .catch(swallowNonBuiltins)
  }

  const onWatchReplay = () => {
    if (!report?.replay || !report.game || !IS_ELECTRON) {
      return
    }
    const { replay, game } = report
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
      {report ? (
        <Items>
          <Item>
            <ItemLabel>Reporter:</ItemLabel>
            <ItemValue>
              <ConnectedUsername userId={report.reporter!.id} />
            </ItemValue>
          </Item>
          <Item>
            <ItemLabel>Reporter history:</ItemLabel>
            <ItemValue>{formatStats(report.reporterStats)}</ItemValue>
          </Item>
          <Item>
            <ItemLabel>Reported player:</ItemLabel>
            <ItemValue>
              <ConnectedUsername userId={report.reportedUser!.id} />
            </ItemValue>
          </Item>
          <Item>
            <ItemLabel>Reports against:</ItemLabel>
            <ItemValue>{formatStats(report.reportedUserStats)}</ItemValue>
          </Item>
          <Item>
            <ItemLabel>Reason:</ItemLabel>
            <ItemValue>{reasonToLabel(report.reason)}</ItemValue>
          </Item>
          <Item>
            <ItemLabel>Submitted at:</ItemLabel>
            <ItemValue>{longTimestamp.format(new Date(report.createdAt))}</ItemValue>
          </Item>
          <Item>
            <ItemLabel>Game:</ItemLabel>
            <ItemValue>
              {report.game ? (
                <Link href={urlPath`/games/${report.game.id}`}>View game</Link>
              ) : (
                'Game not found'
              )}
            </ItemValue>
          </Item>
          <Item>
            <ItemLabel>Replay:</ItemLabel>
            <ItemValue>
              {report.replay ? (
                <ResolveActions>
                  <OutlinedButton
                    label='Download replay'
                    iconStart={<MaterialIcon icon='download' />}
                    onClick={() => {
                      const a = document.createElement('a')
                      a.href = report.replay!.url
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
                </ResolveActions>
              ) : (
                'No replay available'
              )}
            </ItemValue>
          </Item>
          {report.details ? (
            <Item>
              <ItemLabel>Details:</ItemLabel>
              <DetailsValue>{report.details}</DetailsValue>
            </Item>
          ) : null}
          {report.resolvedAt ? (
            <>
              <Item>
                <ItemLabel>Resolved at:</ItemLabel>
                <ItemValue>{longTimestamp.format(new Date(report.resolvedAt))}</ItemValue>
              </Item>
              <Item>
                <ItemLabel>Outcome:</ItemLabel>
                <ItemValue>
                  {report.resolution ? resolutionToLabel(report.resolution) : '—'}
                </ItemValue>
              </Item>
              <Item>
                <ItemLabel>Resolved by:</ItemLabel>
                <ItemValue>
                  {report.resolver ? (
                    <ConnectedUsername userId={report.resolver.id} />
                  ) : (
                    'Unknown user'
                  )}
                </ItemValue>
              </Item>
              {report.resolutionNotes ? (
                <Item>
                  <ItemLabel>Resolution notes:</ItemLabel>
                  <DetailsValue>{report.resolutionNotes}</DetailsValue>
                </Item>
              ) : null}
              <Item>
                <ItemLabel>Restrict reporting:</ItemLabel>
                <ItemValue>
                  <Link
                    href={urlPath`/users/${report.reporter!.id}/${
                      report.reporter!.name
                    }/admin/punishments`}>
                    Restrict this reporter
                  </Link>
                </ItemValue>
              </Item>
            </>
          ) : (
            <>
              <Item>
                <ItemLabel>Resolution notes:</ItemLabel>
                <ItemValue>
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
                </ItemValue>
              </Item>
              <Item>
                <ItemLabel>Resolve as:</ItemLabel>
                <ItemValue>
                  <ResolveActions>
                    <FilledButton
                      label='Actioned'
                      disabled={resolving}
                      onClick={() => onResolve(GameReportResolution.Actioned)}
                    />
                    <OutlinedButton
                      label='Dismissed'
                      disabled={resolving}
                      onClick={() => onResolve(GameReportResolution.Dismissed)}
                    />
                    <OutlinedButton
                      label='Abusive report'
                      disabled={resolving}
                      onClick={() => onResolve(GameReportResolution.Abusive)}
                    />
                    <OutlinedButton
                      label='Duplicate'
                      disabled={resolving}
                      onClick={() => onResolve(GameReportResolution.Duplicate)}
                    />
                  </ResolveActions>
                </ItemValue>
              </Item>
            </>
          )}
        </Items>
      ) : null}
    </Content>
  )
}
