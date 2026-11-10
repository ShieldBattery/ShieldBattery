import * as React from 'react'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { Link } from 'wouter'
import { urlForMap } from '../../common/map-url'
import { filterColorCodes, makeMapFamilyId, SbMapId } from '../../common/maps'
import { graphql } from '../gql'
import { MapFamilyReportKind, MapFamilyReportStatus, MapReportBarQuery } from '../gql/graphql'
import { NarrowDuration } from '../i18n/date-formats'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { LoadErrorRow } from '../lists/load-error-row'
import { FilledButton, TextButton } from '../material/button'
import { Card } from '../material/card'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { openMapFamilyActionDialog } from './action-creators'
import { useChangeReportStatus } from './map-report-status'

// Only staff review reports, so this isn't translated.

const ReportQuery = graphql(/* GraphQL */ `
  query MapReportBar($id: UUID!) {
    mapFamilyReportById(id: $id) {
      id
      kind
      note
      reportedAt
      status
      resolvedAt
      reportedBy {
        id
      }
      resolvedBy {
        id
      }
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
        firstSeenAt
        stats {
          id
          gamesTotal
        }
      }
      otherFamily {
        id
        name
        current {
          id
        }
      }
    }
  }
`)

/**
 * Requests results without suspending: the bar renders its own loading state. Module-level so the
 * query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const uploadedFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

const StyledCard = styled(Card)`
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

const Claim = styled.div`
  ${bodyLarge};
  overflow-wrap: anywhere;
`

const MutedLine = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
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

const MutedText = styled.span`
  color: var(--theme-on-surface-variant);
`

const Actions = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 8px;
`

const StatusText = styled(InlineParts)`
  justify-content: flex-end;
`

const MessageText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/**
 * What a map report says and the actions to settle it, for staff reviewing the report next to the
 * files it's about.
 */
export function MapReportBar({ reportId }: { reportId: string }) {
  const [{ data, error }, reexecuteQuery] = useQuery({
    query: ReportQuery,
    variables: { id: reportId },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })

  const report = data?.mapFamilyReportById
  if (report) {
    return <LoadedReportBar report={report} />
  }

  let content: React.ReactNode
  if (error) {
    content = (
      <LoadErrorRow
        message="Couldn't load the report"
        onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
      />
    )
  } else if (data) {
    content = <MessageText>Report not found</MessageText>
  } else {
    content = <LoadingDotsArea />
  }
  return <StyledCard>{content}</StyledCard>
}

type Report = NonNullable<MapReportBarQuery['mapFamilyReportById']>

function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function LoadedReportBar({ report }: { report: Report }) {
  const uploadedDate = useFormat(uploadedFormat)
  const isOpen = report.status === MapFamilyReportStatus.Open

  const deletedMap = <MutedText>Deleted map</MutedText>
  const mapLink = (
    family: { id: string; name: string } | null | undefined,
    file?: { id: SbMapId },
  ) =>
    family ? (
      <Link href={urlForMap(makeMapFamilyId(family.id), family.name, undefined, file?.id)}>
        {filterColorCodes(family.name)}
      </Link>
    ) : (
      deletedMap
    )

  let claim: React.ReactNode
  if (report.kind === MapFamilyReportKind.WrongMap) {
    const file = report.map
    claim = (
      <>
        {file
          ? `${filterColorCodes(file.name)} (${uploadedDate.format(new Date(file.firstSeenAt))} · ${pluralize(file.stats?.gamesTotal ?? 0, 'game', 'games')})`
          : deletedMap}
        {" doesn't belong in "}
        {mapLink(report.family, file ?? undefined)}
      </>
    )
  } else {
    claim = (
      <>
        {mapLink(report.family)}
        {' is the same map as '}
        {mapLink(report.otherFamily)}
      </>
    )
  }

  return (
    <StyledCard>
      <Details>
        <Claim>{claim}</Claim>
        <InlineParts>
          <span>Reported by</span>
          {report.reportedBy ? (
            <ConnectedUsername userId={report.reportedBy.id} />
          ) : (
            <span>an unknown user</span>
          )}
          <span>·</span>
          <NarrowDuration to={new Date(report.reportedAt)} />
        </InlineParts>
        {report.note ? <MutedLine>{`“${report.note}”`}</MutedLine> : null}
      </Details>
      <Actions>
        {isOpen ? <OpenActions report={report} /> : <ClosedActions report={report} />}
      </Actions>
    </StyledCard>
  )
}

function ClosedActions({ report }: { report: Report }) {
  const changeStatus = useChangeReportStatus()
  const verb = report.status === MapFamilyReportStatus.Dismissed ? 'Dismissed' : 'Resolved'
  return (
    <>
      <StatusText>
        <span>{verb}</span>
        {report.resolvedAt ? <NarrowDuration to={new Date(report.resolvedAt)} /> : null}
        {report.resolvedBy ? (
          <>
            <span>by</span>
            <ConnectedUsername userId={report.resolvedBy.id} />
          </>
        ) : null}
      </StatusText>
      <TextButton
        label='Reopen'
        onClick={() => changeStatus(report.id, MapFamilyReportStatus.Open)}
      />
    </>
  )
}

function OpenActions({ report }: { report: Report }) {
  const dispatch = useAppDispatch()
  const changeStatus = useChangeReportStatus()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'bottom')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  const { family, map, otherFamily } = report
  const items: Array<[text: string, onClick: () => void]> = []
  if (report.kind === MapFamilyReportKind.WrongMap) {
    if (family && map) {
      items.push([
        'Move file to another map…',
        () =>
          dispatch(
            openMapFamilyActionDialog({
              action: 'move',
              familyId: family.id,
              fileId: map.id,
              reportId: report.id,
            }),
          ),
      ])
      if (family.files.length > 1) {
        items.push([
          'Split file into its own map…',
          () =>
            dispatch(
              openMapFamilyActionDialog({
                action: 'split',
                familyId: family.id,
                fileId: map.id,
                reportId: report.id,
              }),
            ),
        ])
      }
    }
  } else if (family && otherFamily) {
    items.push([
      `Merge into ${filterColorCodes(otherFamily.name)}…`,
      () =>
        dispatch(
          openMapFamilyActionDialog({
            action: 'merge',
            familyId: family.id,
            reportId: report.id,
            targetFamilyId: otherFamily.id,
          }),
        ),
    ])
  }
  items.push([
    'Mark resolved, no change needed',
    () => changeStatus(report.id, MapFamilyReportStatus.Resolved),
  ])

  return (
    <>
      <TextButton
        label='Dismiss'
        onClick={() => changeStatus(report.id, MapFamilyReportStatus.Dismissed)}
      />
      <FilledButton ref={anchorRef} label='Resolve' onClick={openMenu} />
      <Popover
        open={open}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList dense={true}>
          {items.map(([text, onClick]) => (
            <MenuItem
              key={text}
              text={text}
              dense={true}
              onClick={() => {
                closeMenu()
                onClick()
              }}
            />
          ))}
        </MenuList>
      </Popover>
    </>
  )
}
