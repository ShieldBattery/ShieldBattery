import { ReactNode, useState } from 'react'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { Link, useRoute } from 'wouter'
import { urlForMap, urlForMapCollection } from '../../common/map-url'
import { filterColorCodes, makeMapCollectionId, makeMapFamilyId } from '../../common/maps'
import { urlPath } from '../../common/urls'
import { graphql } from '../gql'
import {
  AdminMapFamilyReportsQuery,
  AdminMapOwnerClaimsQuery,
  MapFamilyReportKind,
  MapFamilyReportStatus,
  MapPublishReviewAnswer,
} from '../gql/graphql'
import { NarrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium, labelLarge, singleLine, titleLarge } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { sameMapReportCompareUrl, wrongMapReportCompareUrl } from './map-family-files'
import { serverErrorText } from './map-owner-actions'
import { useChangeReportStatus } from './map-report-status'

// An admin-only page, so it isn't translated.

const PAGE_SIZE = 50

const MapFamilyReportsQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyReports($status: MapFamilyReportStatus!, $limit: Int!, $offset: Int!) {
    mapFamilyReports(status: $status, limit: $limit, offset: $offset) {
      id
      kind
      note
      fromPublish
      publishAnswer
      reportedAt
      status
      resolvedAt
      family {
        id
        name
        current {
          id
        }
        files {
          id
        }
      }
      map {
        id
        name
      }
      otherFamily {
        id
        name
        current {
          id
        }
      }
      reportedBy {
        id
      }
      resolvedBy {
        id
      }
    }
  }
`)

const MapFamilyReportCountsQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyReportCounts {
    open: mapFamilyReportCount(status: OPEN)
    resolved: mapFamilyReportCount(status: RESOLVED)
    dismissed: mapFamilyReportCount(status: DISMISSED)
    openClaims: mapOwnerClaimCount(status: OPEN)
    openCollectionReports: mapCollectionReportCount
  }
`)

const STATUS_PARAM_VALUES: Record<MapFamilyReportStatus, string> = {
  [MapFamilyReportStatus.Open]: 'open',
  [MapFamilyReportStatus.Resolved]: 'resolved',
  [MapFamilyReportStatus.Dismissed]: 'dismissed',
}

function statusFromParam(value: string): MapFamilyReportStatus {
  return (
    (Object.keys(STATUS_PARAM_VALUES) as MapFamilyReportStatus[]).find(
      status => STATUS_PARAM_VALUES[status] === value,
    ) ?? MapFamilyReportStatus.Open
  )
}

const Content = styled.div`
  max-width: 1080px;
  margin: 0 16px;
  padding-bottom: 32px;
`

const PageHeadline = styled.div`
  ${titleLarge};
`

const HeadlineRow = styled.div`
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  margin-bottom: 8px;
`

const StyledTabs = styled(Tabs)`
  margin-bottom: 16px;
` as typeof Tabs

const ErrorText = styled.div`
  ${bodyLarge};
  padding: 16px;
  color: var(--theme-error);
`

const EmptyText = styled.div`
  ${bodyLarge};
  padding: 16px;
  color: var(--theme-on-surface-variant);
`

const Table = styled.div`
  width: 100%;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const TableRow = styled.div`
  ${bodyMedium};
  min-height: 48px;

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
  ${labelLarge};
  cursor: default;

  &:hover {
    background-color: transparent;
  }
`

const Cell = styled.div<{ $width?: number }>`
  ${singleLine};
  flex: ${props => (props.$width ? `0 0 ${props.$width}px` : '1 1 0')};
  min-width: 0;
  padding: 8px 12px;
`

const WrappingCell = styled(Cell)`
  white-space: normal;
  overflow-wrap: anywhere;
`

const ActionsCell = styled(Cell)`
  padding-block: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  overflow: visible;
`

const MutedText = styled.span`
  color: var(--theme-on-surface-variant);
`

const LoadMoreRow = styled.div`
  display: flex;
  justify-content: center;
  padding: 12px;
`

/** The tabs of the map reports page, as its URL names them. */
enum MapReportsTab {
  Reports = 'reports',
  Claims = 'claims',
  Collections = 'collections',
}

const ALL_MAP_REPORTS_TABS: ReadonlyArray<MapReportsTab> = Object.values(MapReportsTab)

function tabText(label: string, count: number | undefined) {
  return count === undefined ? label : `${label} (${count})`
}

/**
 * Players' reports about maps and their files, files held for review when they were published,
 * players' claims to be the maker of a map, and players' reports about public collections. Each report row opens the report where staff
 * settle it: on the comparison of the files involved, or on the page of the map or file it's
 * about. A report with nowhere to settle it opens the map's page instead, and is resolved or
 * dismissed from its row's menu. Claims are granted or rejected from their rows. A collection
 * report opens the collection's page, where staff dismiss it or hide the collection.
 */
export function AdminMapReports() {
  const [, params] = useRoute<{ tab?: string }>('/admin/maps/reports/:tab?')
  const tab = ALL_MAP_REPORTS_TABS.find(t => t === params?.tab) ?? MapReportsTab.Reports
  const [statusParam, setStatusParam] = useLocationSearchParam('status')
  const status = statusFromParam(statusParam)
  // Bumped on refresh to re-mount the pages and force a fresh fetch.
  const [refreshToken, setRefreshToken] = useState(0)
  const [{ data: counts }, refetchCounts] = useQuery({
    query: MapFamilyReportCountsQuery,
    requestPolicy: 'cache-and-network',
  })

  return (
    <Content>
      <HeadlineRow>
        <PageHeadline>Map reports</PageHeadline>
        <FilledButton
          label='Refresh'
          onClick={() => {
            setRefreshToken(t => t + 1)
            refetchCounts({ requestPolicy: 'network-only' })
          }}
        />
      </HeadlineRow>
      <StyledTabs
        activeTab={tab}
        onChange={(value: MapReportsTab) =>
          push(
            value === MapReportsTab.Reports
              ? '/admin/maps/reports'
              : urlPath`/admin/maps/reports/${value}`,
          )
        }>
        <TabItem value={MapReportsTab.Reports} text={tabText('Reports', counts?.open)} />
        <TabItem value={MapReportsTab.Claims} text={tabText('Claims', counts?.openClaims)} />
        <TabItem
          value={MapReportsTab.Collections}
          text={tabText('Collections', counts?.openCollectionReports)}
        />
      </StyledTabs>
      {tab === MapReportsTab.Claims ? <ClaimsTable key={refreshToken} /> : null}
      {tab === MapReportsTab.Collections ? <CollectionReportsTable key={refreshToken} /> : null}
      {tab === MapReportsTab.Reports ? (
        <ReportsTab
          status={status}
          counts={counts}
          refreshToken={refreshToken}
          onStatusChange={setStatusParam}
        />
      ) : null}
    </Content>
  )
}

function ReportsTab({
  status,
  counts,
  refreshToken,
  onStatusChange,
}: {
  status: MapFamilyReportStatus
  counts?: { open: number; resolved: number; dismissed: number }
  refreshToken: number
  /** Sets the status param of the URL: empty for open reports. */
  onStatusChange: (value: string) => void
}) {
  return (
    <>
      <StyledTabs
        activeTab={status}
        onChange={(value: MapFamilyReportStatus) =>
          onStatusChange(value === MapFamilyReportStatus.Open ? '' : STATUS_PARAM_VALUES[value])
        }>
        <TabItem value={MapFamilyReportStatus.Open} text={tabText('Open', counts?.open)} />
        <TabItem
          value={MapFamilyReportStatus.Resolved}
          text={tabText('Resolved', counts?.resolved)}
        />
        <TabItem
          value={MapFamilyReportStatus.Dismissed}
          text={tabText('Dismissed', counts?.dismissed)}
        />
      </StyledTabs>
      <ReportsTable key={`${status}-${refreshToken}`} status={status} />
    </>
  )
}

function ReportsTable({ status }: { status: MapFamilyReportStatus }) {
  const [pages, setPages] = useState(1)
  const isOpen = status === MapFamilyReportStatus.Open
  return (
    <Table>
      <TableHeader>
        <Cell $width={104}>Reported</Cell>
        <Cell $width={200}>Map</Cell>
        <Cell $width={240}>Report</Cell>
        <Cell>Note</Cell>
        <Cell $width={140}>Reporter</Cell>
        {isOpen ? null : <Cell $width={160}>Closed</Cell>}
        <Cell $width={64} />
      </TableHeader>
      {Array.from({ length: pages }, (_, i) => (
        <ReportsPage
          key={i}
          status={status}
          offset={i * PAGE_SIZE}
          isLastPage={i === pages - 1}
          onLoadMore={() => setPages(p => p + 1)}
        />
      ))}
    </Table>
  )
}

function ReportsPage({
  status,
  offset,
  isLastPage,
  onLoadMore,
}: {
  status: MapFamilyReportStatus
  offset: number
  isLastPage: boolean
  onLoadMore: () => void
}) {
  const changeStatus = useChangeReportStatus()
  const [{ data, fetching, error }] = useQuery({
    query: MapFamilyReportsQuery,
    variables: { status, limit: PAGE_SIZE, offset },
    requestPolicy: 'cache-and-network',
  })
  const reports = data?.mapFamilyReports ?? []
  const isOpen = status === MapFamilyReportStatus.Open

  return (
    <>
      {reports.map(r => {
        const mapUrl = r.family
          ? urlForMap(
              makeMapFamilyId(r.family.id),
              r.family.name,
              undefined,
              r.kind === MapFamilyReportKind.SameMap || r.kind === MapFamilyReportKind.WrongOwner
                ? undefined
                : r.map?.id,
            )
          : undefined
        const reviewUrl = reportReviewUrl(r)
        const rowUrl = reviewUrl ?? mapUrl
        const dismiss: [string, () => void] = [
          'Dismiss',
          () => changeStatus(r.id, MapFamilyReportStatus.Dismissed),
        ]
        let menuItems: Array<[text: string, handler: () => void]>
        if (!isOpen) {
          menuItems = [['Reopen', () => changeStatus(r.id, MapFamilyReportStatus.Open)]]
        } else if (r.kind === MapFamilyReportKind.PublishReview) {
          // Resolving a held file means listing it, which marking the report resolved doesn't do
          menuItems = [dismiss]
        } else {
          menuItems = [
            ['Resolve', () => changeStatus(r.id, MapFamilyReportStatus.Resolved)],
            dismiss,
          ]
        }
        return (
          <TableRow key={r.id} onClick={rowUrl ? () => push(rowUrl) : undefined}>
            <Cell $width={104}>
              <NarrowDuration to={new Date(r.reportedAt)} />
            </Cell>
            <Cell $width={200} onClick={e => e.stopPropagation()}>
              {r.family && mapUrl ? (
                <Link href={mapUrl}>{filterColorCodes(r.family.name)}</Link>
              ) : (
                <MutedText>Deleted map</MutedText>
              )}
            </Cell>
            <WrappingCell $width={240} onClick={e => e.stopPropagation()}>
              <ReportSummary report={r} />
            </WrappingCell>
            <WrappingCell>{r.note ? r.note : <MutedText>No note</MutedText>}</WrappingCell>
            <Cell $width={140} onClick={e => e.stopPropagation()}>
              {r.reportedBy ? (
                <ConnectedUsername userId={r.reportedBy.id} />
              ) : (
                <MutedText>Unknown user</MutedText>
              )}
            </Cell>
            {isOpen ? null : (
              <Cell $width={160} onClick={e => e.stopPropagation()}>
                {r.resolvedAt ? <NarrowDuration to={new Date(r.resolvedAt)} /> : null}
                {r.resolvedBy ? (
                  <>
                    {' by '}
                    <ConnectedUsername userId={r.resolvedBy.id} />
                  </>
                ) : null}
              </Cell>
            )}
            <ActionsCell $width={64} onClick={e => e.stopPropagation()}>
              {reviewUrl ? null : <ReportMenu items={menuItems} />}
            </ActionsCell>
          </TableRow>
        )
      })}
      {offset === 0 && data && !reports.length ? (
        <EmptyText>{`No ${STATUS_PARAM_VALUES[status]} reports.`}</EmptyText>
      ) : null}
      {fetching && !data ? <LoadingDotsArea /> : null}
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {isLastPage && reports.length === PAGE_SIZE ? (
        <LoadMoreRow>
          <OutlinedButton label='Load more' onClick={onLoadMore} />
        </LoadMoreRow>
      ) : null}
    </>
  )
}

type ReportRow = AdminMapFamilyReportsQuery['mapFamilyReports'][number]

/**
 * The page that reviews a report: the comparison of the files it's about, if there are any to
 * compare, or else the page of the map or file it's about, with the report's actions.
 */
function reportReviewUrl(report: ReportRow): string | undefined {
  if (!report.family) {
    return undefined
  }
  if (report.kind === MapFamilyReportKind.WrongMap) {
    return report.map
      ? wrongMapReportCompareUrl(report.family, report.map.id, report.id)
      : undefined
  }
  if (
    report.kind === MapFamilyReportKind.PublishReview ||
    report.kind === MapFamilyReportKind.WrongDefault ||
    report.kind === MapFamilyReportKind.Inappropriate
  ) {
    return report.map
      ? urlForMap(
          makeMapFamilyId(report.family.id),
          report.family.name,
          undefined,
          report.map.id,
          report.id,
        )
      : undefined
  }
  if (report.kind === MapFamilyReportKind.WrongOwner) {
    return urlForMap(
      makeMapFamilyId(report.family.id),
      report.family.name,
      undefined,
      undefined,
      report.id,
    )
  }
  return report.otherFamily
    ? sameMapReportCompareUrl(report.family, report.otherFamily, report.id)
    : undefined
}

/** What a report says, linking to the other map it names. */
function ReportSummary({ report }: { report: ReportRow }) {
  if (report.kind === MapFamilyReportKind.WrongOwner) {
    return <MutedText>Its maker didn&apos;t make it</MutedText>
  }
  if (report.kind === MapFamilyReportKind.WrongDefault) {
    return (
      <span>
        {report.map ? filterColorCodes(report.map.name) : 'A file'}{' '}
        <MutedText>should be the recommended file</MutedText>
      </span>
    )
  }
  if (report.kind === MapFamilyReportKind.Inappropriate) {
    return (
      <span>
        {report.map ? filterColorCodes(report.map.name) : 'A file'}{' '}
        <MutedText>is inappropriate</MutedText>
      </span>
    )
  }
  if (report.kind === MapFamilyReportKind.WrongMap) {
    return (
      <span>
        {report.map ? filterColorCodes(report.map.name) : 'A file'}{' '}
        <MutedText>isn&apos;t part of this map</MutedText>
      </span>
    )
  }
  if (report.kind === MapFamilyReportKind.PublishReview) {
    return (
      <span>
        {report.map ? filterColorCodes(report.map.name) : 'A file'}{' '}
        <MutedText>was held for review when published</MutedText>
        {report.publishAnswer ? (
          <>
            <MutedText>
              {report.publishAnswer === MapPublishReviewAnswer.Join
                ? ' · version of '
                : ' · might be a version of '}
            </MutedText>
            {report.otherFamily ? (
              <Link
                href={urlForMap(makeMapFamilyId(report.otherFamily.id), report.otherFamily.name)}>
                {filterColorCodes(report.otherFamily.name)}
              </Link>
            ) : (
              'a deleted map'
            )}
          </>
        ) : null}
      </span>
    )
  }
  return (
    <span>
      <MutedText>{report.fromPublish ? 'Might be a version of ' : 'Same as '}</MutedText>
      {report.otherFamily ? (
        <Link href={urlForMap(makeMapFamilyId(report.otherFamily.id), report.otherFamily.name)}>
          {filterColorCodes(report.otherFamily.name)}
        </Link>
      ) : (
        'a deleted map'
      )}
      {report.fromPublish ? <MutedText> (publisher wasn&apos;t sure)</MutedText> : null}
    </span>
  )
}

function ReportMenu({ items }: { items: ReadonlyArray<[text: string, handler: () => void]> }) {
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  return (
    <>
      <Tooltip text='Report actions' position='left' tabIndex={-1}>
        <IconButton
          ref={anchorRef}
          icon={<MaterialIcon icon='more_vert' />}
          ariaLabel='Report actions'
          ariaHasPopup='menu'
          ariaExpanded={open}
          onClick={openMenu}
        />
      </Tooltip>
      <Popover
        open={open}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList dense={true}>
          {items.map(([text, handler]) => (
            <MenuItem
              key={text}
              text={text}
              dense={true}
              onClick={() => {
                closeMenu()
                handler()
              }}
            />
          ))}
        </MenuList>
      </Popover>
    </>
  )
}

const MapOwnerClaimsQuery = graphql(/* GraphQL */ `
  query AdminMapOwnerClaims($limit: Int!, $offset: Int!) {
    mapOwnerClaims(status: OPEN, limit: $limit, offset: $offset) {
      id
      note
      status
      createdAt
      claimant {
        id
      }
      family {
        id
        name
        owner {
          id
        }
      }
    }
  }
`)

/** Selects what the claim's views and its map's views show, so they update from the result. */
const GrantClaimMutation = graphql(/* GraphQL */ `
  mutation AdminMapOwnerClaimGrant($claimId: UUID!) {
    mapOwnerClaimGrant(claimId: $claimId) {
      id
      status
      resolvedAt
      resolvedBy {
        id
      }
      family {
        id
        ...MapOwner_FamilyOwnerFragment
      }
    }
  }
`)

const RejectClaimMutation = graphql(/* GraphQL */ `
  mutation AdminMapOwnerClaimReject($claimId: UUID!) {
    mapOwnerClaimReject(claimId: $claimId) {
      id
      status
      resolvedAt
      resolvedBy {
        id
      }
    }
  }
`)

/** The server returns at most this many claims at a time. */
const CLAIMS_PAGE_SIZE = 50

const ClaimTableRow = styled(TableRow)`
  cursor: default;
`

/** A cell whose text is cut to one line, with all of it in a tooltip. */
const NoteText = styled.span`
  ${singleLine};
  display: block;
`

const ClaimActions = styled(ActionsCell)`
  gap: 4px;
`

/** The claims table's frame and column headings, with `children` as its rows. */
export function ClaimsTableFrame({ children }: { children: ReactNode }) {
  return (
    <Table>
      <TableHeader>
        <Cell $width={104}>Claimed</Cell>
        <Cell $width={200}>Map</Cell>
        <Cell $width={140}>Claimant</Cell>
        <Cell $width={140}>Current maker</Cell>
        <Cell>Note</Cell>
        <Cell $width={184} />
      </TableHeader>
      {children}
    </Table>
  )
}

/** The open claims to be the maker of a map, oldest first, each granted or rejected on its row. */
function ClaimsTable() {
  const [pages, setPages] = useState(1)
  return (
    <ClaimsTableFrame>
      {Array.from({ length: pages }, (_, i) => (
        <ClaimsPage
          key={i}
          offset={i * CLAIMS_PAGE_SIZE}
          isLastPage={i === pages - 1}
          onLoadMore={() => setPages(p => p + 1)}
        />
      ))}
    </ClaimsTableFrame>
  )
}

function ClaimsPage({
  offset,
  isLastPage,
  onLoadMore,
}: {
  offset: number
  isLastPage: boolean
  onLoadMore: () => void
}) {
  const snackbarController = useSnackbarController()
  const [{ data, fetching, error }] = useQuery({
    query: MapOwnerClaimsQuery,
    variables: { limit: CLAIMS_PAGE_SIZE, offset },
    requestPolicy: 'cache-and-network',
  })
  const [{ fetching: granting }, grant] = useMutation(GrantClaimMutation)
  const [{ fetching: rejecting }, reject] = useMutation(RejectClaimMutation)
  const claims = data?.mapOwnerClaims ?? []

  const settle = (
    request: Promise<{ error?: Parameters<typeof serverErrorText>[0] }>,
    done: string,
    failed: string,
  ) => {
    request
      .then(result => {
        snackbarController.showSnackbar(
          result.error ? `${failed}: ${serverErrorText(result.error)}` : done,
        )
      })
      .catch((err: Error) => snackbarController.showSnackbar(`${failed}: ${err.message}`))
  }

  return (
    <>
      {claims.map(claim => (
        <ClaimRow
          key={claim.id}
          claim={claim}
          disabled={granting || rejecting}
          onGrant={() =>
            settle(grant({ claimId: claim.id }), 'Claim granted', "Couldn't grant the claim")
          }
          onReject={() =>
            settle(reject({ claimId: claim.id }), 'Claim rejected', "Couldn't reject the claim")
          }
        />
      ))}
      {offset === 0 && data && !claims.length ? <EmptyText>No open claims.</EmptyText> : null}
      {fetching && !data ? <LoadingDotsArea /> : null}
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {isLastPage && claims.length === CLAIMS_PAGE_SIZE ? (
        <LoadMoreRow>
          <OutlinedButton label='Load more' onClick={onLoadMore} />
        </LoadMoreRow>
      ) : null}
    </>
  )
}

export type ClaimRowData = AdminMapOwnerClaimsQuery['mapOwnerClaims'][number]

/** One claim to be the maker of a map, with the buttons that settle it. */
export function ClaimRow({
  claim,
  disabled,
  onGrant,
  onReject,
}: {
  claim: ClaimRowData
  disabled: boolean
  onGrant: () => void
  onReject: () => void
}) {
  const { family } = claim
  return (
    <ClaimTableRow>
      <Cell $width={104}>
        <NarrowDuration to={new Date(claim.createdAt)} />
      </Cell>
      <Cell $width={200}>
        {family ? (
          <Link href={urlForMap(makeMapFamilyId(family.id), family.name)}>
            {filterColorCodes(family.name)}
          </Link>
        ) : (
          <MutedText>Deleted map</MutedText>
        )}
      </Cell>
      <Cell $width={140}>
        {claim.claimant ? (
          <ConnectedUsername userId={claim.claimant.id} />
        ) : (
          <MutedText>Unknown user</MutedText>
        )}
      </Cell>
      <Cell $width={140}>
        {family?.owner ? (
          <ConnectedUsername userId={family.owner.id} />
        ) : (
          <MutedText>None</MutedText>
        )}
      </Cell>
      <Cell>
        {claim.note ? (
          <Tooltip text={claim.note} position='bottom'>
            <NoteText>{claim.note}</NoteText>
          </Tooltip>
        ) : (
          <MutedText>No note</MutedText>
        )}
      </Cell>
      <ClaimActions $width={184}>
        <TextButton label='Reject' disabled={disabled} onClick={onReject} />
        <FilledButton label='Grant' disabled={disabled} onClick={onGrant} />
      </ClaimActions>
    </ClaimTableRow>
  )
}

const MapCollectionReportsQuery = graphql(/* GraphQL */ `
  query AdminMapCollectionReports($after: String, $first: Int!) {
    mapCollectionReports(open: true, after: $after, first: $first) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          note
          createdAt
          reporter {
            id
          }
          collection {
            id
            title
            owner {
              id
            }
          }
        }
      }
    }
  }
`)

/** How many collection reports each page of the table loads. */
const COLLECTION_REPORTS_PAGE_SIZE = 50

/** The open reports about collections, oldest first, each opening the collection's page. */
function CollectionReportsTable() {
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  return (
    <Table>
      <TableHeader>
        <Cell $width={104}>Reported</Cell>
        <Cell $width={240}>Collection</Cell>
        <Cell $width={140}>Owner</Cell>
        <Cell>Note</Cell>
        <Cell $width={140}>Reporter</Cell>
      </TableHeader>
      {pageCursors.map((cursor, i) => (
        <CollectionReportsPage
          key={cursor ?? 'first'}
          after={cursor}
          isLastPage={i === pageCursors.length - 1}
          onLoadMore={endCursor =>
            setPageCursors(prev => (prev.includes(endCursor) ? prev : [...prev, endCursor]))
          }
        />
      ))}
    </Table>
  )
}

function CollectionReportsPage({
  after,
  isLastPage,
  onLoadMore,
}: {
  after: string | null
  isLastPage: boolean
  onLoadMore: (endCursor: string) => void
}) {
  const [{ data, fetching, error }] = useQuery({
    query: MapCollectionReportsQuery,
    variables: { after: after ?? undefined, first: COLLECTION_REPORTS_PAGE_SIZE },
    requestPolicy: 'cache-and-network',
  })
  const connection = data?.mapCollectionReports
  const reports = connection?.edges.map(e => e.node) ?? []
  const endCursor = connection?.pageInfo.endCursor

  return (
    <>
      {reports.map(r => {
        const { collection } = r
        const url = collection
          ? urlForMapCollection(
              makeMapCollectionId(collection.id),
              collection.title ?? undefined,
              r.id,
            )
          : undefined
        return (
          <TableRow key={r.id} onClick={url ? () => push(url) : undefined}>
            <Cell $width={104}>
              <NarrowDuration to={new Date(r.createdAt)} />
            </Cell>
            <Cell $width={240}>
              {collection ? collection.title : <MutedText>Made private by its owner</MutedText>}
            </Cell>
            <Cell $width={140} onClick={e => e.stopPropagation()}>
              {collection?.owner ? <ConnectedUsername userId={collection.owner.id} /> : null}
            </Cell>
            <WrappingCell>{r.note}</WrappingCell>
            <Cell $width={140} onClick={e => e.stopPropagation()}>
              {r.reporter ? (
                <ConnectedUsername userId={r.reporter.id} />
              ) : (
                <MutedText>Unknown user</MutedText>
              )}
            </Cell>
          </TableRow>
        )
      })}
      {!after && data && !reports.length ? (
        <EmptyText>No open collection reports.</EmptyText>
      ) : null}
      {fetching && !data ? <LoadingDotsArea /> : null}
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {isLastPage && connection?.pageInfo.hasNextPage && endCursor ? (
        <LoadMoreRow>
          <OutlinedButton label='Load more' onClick={() => onLoadMore(endCursor)} />
        </LoadMoreRow>
      ) : null}
    </>
  )
}
