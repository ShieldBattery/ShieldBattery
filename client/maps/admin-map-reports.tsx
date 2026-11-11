import { useState } from 'react'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { Link } from 'wouter'
import { urlForMap } from '../../common/map-url'
import { filterColorCodes, makeMapFamilyId } from '../../common/maps'
import { graphql } from '../gql'
import {
  AdminMapFamilyReportsQuery,
  MapFamilyReportKind,
  MapFamilyReportStatus,
} from '../gql/graphql'
import { NarrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, IconButton, OutlinedButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { bodyLarge, bodyMedium, labelLarge, singleLine, titleLarge } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { sameMapReportCompareUrl, wrongMapReportCompareUrl } from './map-family-files'
import { useChangeReportStatus } from './map-report-status'

// An admin-only page, so it isn't translated.

const PAGE_SIZE = 50

const MapFamilyReportsQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyReports($status: MapFamilyReportStatus!, $limit: Int!, $offset: Int!) {
    mapFamilyReports(status: $status, limit: $limit, offset: $offset) {
      id
      kind
      note
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

/**
 * Players' reports that a file isn't part of its map, or that two maps are the same. Each row
 * opens the report on the comparison of the files involved, where staff settle it. A report with
 * nothing to compare opens the map's page instead, and is resolved or dismissed from its row's
 * menu.
 */
export function AdminMapReports() {
  const [statusParam, setStatusParam] = useLocationSearchParam('status')
  const status = statusFromParam(statusParam)
  // Bumped on refresh to re-mount the pages and force a fresh fetch.
  const [refreshToken, setRefreshToken] = useState(0)
  const [{ data: counts }, refetchCounts] = useQuery({
    query: MapFamilyReportCountsQuery,
    requestPolicy: 'cache-and-network',
  })

  const tabText = (label: string, count: number | undefined) =>
    count === undefined ? label : `${label} (${count})`

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
        activeTab={status}
        onChange={(value: MapFamilyReportStatus) =>
          setStatusParam(value === MapFamilyReportStatus.Open ? '' : STATUS_PARAM_VALUES[value])
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
    </Content>
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
              r.kind === MapFamilyReportKind.SameMap ? undefined : r.map?.id,
            )
          : undefined
        const compareUrl = reportCompareUrl(r)
        const rowUrl = compareUrl ?? mapUrl
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
              {compareUrl ? null : <ReportMenu items={menuItems} />}
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

/** The page that reviews a report next to the files it's about, if there are any to compare. */
function reportCompareUrl(report: ReportRow): string | undefined {
  if (!report.family) {
    return undefined
  }
  if (report.kind === MapFamilyReportKind.WrongMap) {
    return report.map
      ? wrongMapReportCompareUrl(report.family, report.map.id, report.id)
      : undefined
  }
  if (report.kind === MapFamilyReportKind.PublishReview) {
    return undefined
  }
  return report.otherFamily
    ? sameMapReportCompareUrl(report.family, report.otherFamily, report.id)
    : undefined
}

/** What a report says, linking to the other map it names. */
function ReportSummary({ report }: { report: ReportRow }) {
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
      </span>
    )
  }
  return (
    <span>
      <MutedText>Same as </MutedText>
      {report.otherFamily ? (
        <Link href={urlForMap(makeMapFamilyId(report.otherFamily.id), report.otherFamily.name)}>
          {filterColorCodes(report.otherFamily.name)}
        </Link>
      ) : (
        'a deleted map'
      )}
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
