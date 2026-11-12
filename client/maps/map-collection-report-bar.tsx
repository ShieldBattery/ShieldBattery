import * as React from 'react'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { graphql } from '../gql'
import { MapCollectionReportBarQuery, MapCollectionReportResolution } from '../gql/graphql'
import { NarrowDuration } from '../i18n/date-formats'
import { LoadErrorRow } from '../lists/load-error-row'
import { OutlinedButton, TextButton } from '../material/button'
import { Card } from '../material/card'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { openMapCollectionHideDialog } from './action-creators'

// Only staff review reports, so this isn't translated.

/**
 * How many reports are searched for the one the bar is about. The server can't look a collection
 * report up by its id, so the bar finds it in the listings of open and resolved reports.
 */
const REPORT_SEARCH_SIZE = 100

const CollectionReportsQuery = graphql(/* GraphQL */ `
  query MapCollectionReportBar($open: Boolean!, $first: Int!) {
    mapCollectionReports(open: $open, first: $first) {
      edges {
        node {
          id
          note
          createdAt
          resolvedAt
          resolution
          reporter {
            id
          }
          resolvedBy {
            id
          }
          collection {
            id
          }
        }
      }
    }
  }
`)

const DismissMutation = graphql(/* GraphQL */ `
  mutation MapCollectionReportDismiss($reportId: UUID!) {
    mapCollectionReportDismiss(reportId: $reportId) {
      id
      resolvedAt
      resolution
      resolvedBy {
        id
      }
    }
  }
`)

/** Requests results without suspending: the bar renders its own loading state. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const StyledCard = styled(Card)`
  width: 100%;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
`

const Details = styled.div`
  flex: 1 1 320px;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Note = styled.div`
  ${bodyLarge};
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`

/**
 * A line of text with components in it. Some of them (a duration, a username) render block-level
 * wrappers, so the line lays its pieces out as flex items instead of inline text.
 */
const InlineParts = styled.div`
  ${bodyMedium};

  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 4px;

  color: var(--theme-on-surface-variant);
`

const StatusText = styled(InlineParts)`
  justify-content: flex-end;
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
`

const MessageText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/**
 * What a player reported about a collection and the actions to settle it, for staff reviewing the
 * report on the collection's page: dismissing it, or hiding the collection, which resolves it.
 */
export function MapCollectionReportBar({
  reportId,
  collectionId,
  collectionTitle,
}: {
  reportId: string
  collectionId: string
  /** The collection's title, for the dialog that hides it. */
  collectionTitle: string
}) {
  const openReports = useReportListing(true)
  const openReport = openReports.reports?.find(r => r.id === reportId)
  // A resolved report is only looked for once it's known not to be open
  const resolvedReports = useReportListing(false, !openReports.reports || !!openReport)
  const report = openReport ?? resolvedReports.reports?.find(r => r.id === reportId)

  if (report && report.collection?.id === collectionId) {
    return (
      <LoadedReportBar
        report={report}
        collectionId={collectionId}
        collectionTitle={collectionTitle}
      />
    )
  }

  const error = openReports.error ?? resolvedReports.error
  let content: React.ReactNode
  if (error) {
    content = (
      <LoadErrorRow
        message="Couldn't load the report"
        onRetry={() => {
          openReports.retry()
          resolvedReports.retry()
        }}
      />
    )
  } else if (report || (openReports.reports && resolvedReports.reports)) {
    content = <MessageText>Report not found</MessageText>
  } else {
    content = <LoadingDotsArea />
  }
  return <StyledCard>{content}</StyledCard>
}

/**
 * Whether the report bar for `reportId` offers to settle an open report about the collection
 * `collectionId`, counting a report that's still loading as open. While it does, the bar owns
 * hiding the collection.
 */
export function useCollectionReportOpen(
  reportId: string | undefined,
  collectionId: string,
): boolean {
  const openReports = useReportListing(true, !reportId)
  if (!reportId) {
    return false
  } else if (!openReports.reports) {
    return !openReports.error
  }
  return openReports.reports.some(
    r => r.id === reportId && !r.resolvedAt && r.collection?.id === collectionId,
  )
}

function useReportListing(open: boolean, pause = false) {
  const [{ data, error }, reexecute] = useQuery({
    query: CollectionReportsQuery,
    variables: { open, first: REPORT_SEARCH_SIZE },
    requestPolicy: 'cache-and-network',
    pause,
    context: NO_SUSPENSE_CONTEXT,
  })
  return {
    reports: data?.mapCollectionReports.edges.map(e => e.node),
    error,
    retry: () => reexecute({ requestPolicy: 'network-only' }),
  }
}

type Report = MapCollectionReportBarQuery['mapCollectionReports']['edges'][number]['node']

function LoadedReportBar({
  report,
  collectionId,
  collectionTitle,
}: {
  report: Report
  collectionId: string
  collectionTitle: string
}) {
  return (
    <StyledCard>
      <Details>
        <Note>{`“${report.note}”`}</Note>
        <InlineParts>
          <span>Reported by</span>
          {report.reporter ? (
            <ConnectedUsername userId={report.reporter.id} />
          ) : (
            <span>an unknown user</span>
          )}
          <span>·</span>
          <NarrowDuration to={new Date(report.createdAt)} />
        </InlineParts>
      </Details>
      <Actions>
        {report.resolvedAt ? (
          <ResolvedStatus report={report} />
        ) : (
          <OpenActions
            reportId={report.id}
            collectionId={collectionId}
            collectionTitle={collectionTitle}
          />
        )}
      </Actions>
    </StyledCard>
  )
}

function ResolvedStatus({ report }: { report: Report }) {
  return (
    <StatusText>
      <span>
        {report.resolution === MapCollectionReportResolution.Hidden ? 'Hidden' : 'Dismissed'}
      </span>
      {report.resolvedAt ? <NarrowDuration to={new Date(report.resolvedAt)} /> : null}
      {report.resolvedBy ? (
        <>
          <span>by</span>
          <ConnectedUsername userId={report.resolvedBy.id} />
        </>
      ) : null}
    </StatusText>
  )
}

function OpenActions({
  reportId,
  collectionId,
  collectionTitle,
}: {
  reportId: string
  collectionId: string
  collectionTitle: string
}) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [{ fetching }, dismiss] = useMutation(DismissMutation)

  const onDismiss = () => {
    dismiss({ reportId })
      .then(result => {
        snackbarController.showSnackbar(
          result.error
            ? `Couldn't dismiss the report: ${result.error.graphQLErrors[0]?.message ?? result.error.message}`
            : 'Dismissed',
        )
      })
      .catch(swallowNonBuiltins)
  }

  return (
    <>
      <TextButton label='Dismiss' disabled={fetching} onClick={onDismiss} />
      <OutlinedButton
        label='Hide'
        disabled={fetching}
        onClick={() =>
          dispatch(
            openMapCollectionHideDialog({
              collectionId,
              title: collectionTitle,
            }),
          )
        }
      />
    </>
  )
}
