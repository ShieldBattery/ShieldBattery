import { ResultOf } from '@graphql-typed-document-node/core'
import { atom, useAtom, useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useClient, useMutation, useQuery } from 'urql'
import { Link, Route, Switch } from 'wouter'
import { assertUnreachable } from '../../common/assert-unreachable'
import { mapIdFromRouteSegment, urlForMap, urlForMapCompare } from '../../common/map-url'
import { makeSbMapId, SbMapId, Tileset, tilesetToName } from '../../common/maps'
import { urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { useSelfUser } from '../auth/auth-utils'
import { FragmentType, graphql, useFragment } from '../gql'
import {
  MapFamilyHistoryKind,
  MapFamilyRelation,
  MapFamilyReportKind,
  MapFamilyReportStatus,
  MapLinkSource,
  MapLinkSuggestionDecision,
  MapLinkSuggestionStatus,
  MapProposedRelation,
} from '../gql/graphql'
import { NarrowDuration, shortTimestamp } from '../i18n/date-formats'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { jotaiStore } from '../jotai-store'
import { useKeyListener } from '../keyboard/key-listener'
import { RoomChip } from '../lobbies/room/room-parts'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { Card } from '../material/card'
import { LinkButton } from '../material/link-button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { RadioButton, RadioGroup } from '../material/radio'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TabItem, Tabs } from '../material/tabs'
import { TextField } from '../material/text-field'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  labelLarge,
  singleLine,
  titleLarge,
  titleMedium,
} from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import {
  copyRelation,
  FamilyEditorFile,
  FamilyPlacement,
  FamilyPlacements,
  hasFamilyEdits,
  orderRows,
  parentOptions,
  placeFile,
  planFamilyEdits,
  unansweredFiles,
} from './family-editor'
import { previewFamily, PreviewMember } from './family-preview'
import { MapFileImage } from './map-image'
import { FamilyVersionsList } from './map-page-family'

const BASE_URL = '/admin/map-families'
const PAGE_SIZE = 50
/** How many queued groups "Next" looks through for one that hasn't been skipped. */
const NEXT_LOOKAHEAD = 100
/** How many history entries the family editor loads at a time. */
const EDITOR_HISTORY_PAGE_SIZE = 20

function editorUrl(mapId: SbMapId, withIds: ReadonlyArray<SbMapId> = []): string {
  return withIds.length
    ? urlPath`/admin/map-families/maps/${mapId}?${new URLSearchParams({ with: withIds.join(',') })}`
    : urlPath`/admin/map-families/maps/${mapId}`
}

/** Map ids of the groups skipped with "Next" this session, so "Next" doesn't come back to them. */
const skippedMapIdsAtom = atom<ReadonlySet<SbMapId>>(new Set<SbMapId>())

/**
 * The editor's unsaved changes, kept outside the editor so they survive leaving its page (to
 * compare two of its maps, say) and coming back. Only the most recently edited group's are kept.
 */
const editorDraftAtom = atom<
  | {
      /** The map the editor was opened for, which the editor component is keyed by. */
      key: SbMapId
      edits: ReadonlyMap<SbMapId, FamilyPlacement>
      /** Label edits by family id. */
      familyLabels: ReadonlyMap<string, string>
    }
  | undefined
>(undefined)

const NO_EDITS: ReadonlyMap<SbMapId, FamilyPlacement> = new Map()
const NO_LABEL_EDITS: ReadonlyMap<string, string> = new Map()

const RELATION_LABELS: Record<MapFamilyRelation, string> = {
  [MapFamilyRelation.Root]: 'First version',
  [MapFamilyRelation.Version]: 'Version',
  [MapFamilyRelation.Variant]: 'Copy',
  [MapFamilyRelation.Translation]: 'Translation',
  [MapFamilyRelation.Fork]: 'Based on',
}

const PROPOSED_RELATION_LABELS: Record<MapProposedRelation, string> = {
  [MapProposedRelation.Version]: 'version',
  [MapProposedRelation.Variant]: 'copy',
  [MapProposedRelation.Translation]: 'translation',
  [MapProposedRelation.Fork]: 'based on',
  [MapProposedRelation.TerrainOnly]: 'UMS on the same terrain',
  [MapProposedRelation.Unrelated]: 'not related',
}

const SOURCE_LABELS: Record<MapLinkSource, string> = {
  [MapLinkSource.Rule]: 'Placed by rule',
  [MapLinkSource.Publisher]: 'Placed by publisher',
  [MapLinkSource.Reviewer]: 'Placed by reviewer',
  [MapLinkSource.Moderator]: 'Placed by staff',
}

const MapFamilyProposalCountsQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyCounts {
    mapFamilyProposalCount
    mapFamilyReportCount
  }
`)

const MapFamilyProposalsQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyProposals($limit: Int!, $offset: Int!, $isStaff: Boolean!) {
    mapFamilyProposals(limit: $limit, offset: $offset) {
      id
      games
      maps {
        id
        name
      }
      families {
        id
        familyId
        label @include(if: $isStaff)
      }
      suggestions {
        id
      }
    }
  }
`)

const MapFamilyReportsQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyReports($limit: Int!, $offset: Int!, $isStaff: Boolean!) {
    mapFamilyReports(status: OPEN, limit: $limit, offset: $offset) {
      id
      kind
      suggestedRelation
      note
      reportedAt
      map {
        id
        name
      }
      otherMap {
        id
        name
      }
      reportedBy @include(if: $isStaff) {
        id
      }
    }
  }
`)

const SetReportStatusMutation = graphql(/* GraphQL */ `
  mutation AdminMapFamilyReportSetStatus($id: UUID!, $status: MapFamilyReportStatus!) {
    mapFamilyReportSetStatus(id: $id, status: $status) {
      id
      status
      resolvedAt
    }
  }
`)

const AdminMapFamilies_FileFragment = graphql(/* GraphQL */ `
  fragment AdminMapFamilies_FileFragment on SbMap {
    id
    name
    listed
    official
    firstSeenAt
    stats {
      id
      gamesTotal
    }
    file {
      id
      width
      height
      tileset
      analysis {
        id
        makers
        credited
      }
      ...MapFileImage_FileFragment
    }
  }
`)

const MapFamilyGroupQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyGroup($mapIds: [SbMapId!]!, $isStaff: Boolean!) {
    mapFamilyGroup(mapIds: $mapIds) {
      id
      games
      maps {
        id
        name
        firstSeenAt
        listed
        stats {
          id
          gamesTotal
        }
        ...AdminMapFamilies_FileFragment
      }
      families {
        id
        familyId
        label @include(if: $isStaff)
        members {
          id
          mapId
          parentId
          relation
          versionLabel
          isCurrent
          pinnedCurrent
          source
          map {
            id
            name
            firstSeenAt
            listed
            stats {
              id
              gamesTotal
            }
            ...AdminMapFamilies_FileFragment
          }
        }
      }
      suggestions {
        id
        mapA {
          id
        }
        mapB {
          id
        }
        terrainSimilarity
        nameMatch
        proposedRelation
        olderMapId
        rule
      }
      proposedLinks {
        id
        mapId
        parentId
        relation
        versionLabel
      }
    }
  }
`)

const NextProposalsQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyNextProposals($limit: Int!) {
    mapFamilyProposals(limit: $limit) {
      id
      maps {
        id
      }
    }
  }
`)

const FamilyApplyMutation = graphql(/* GraphQL */ `
  mutation AdminMapFamilyApply($input: MapFamilyApplyInput!) {
    mapFamilyApply(input: $input) {
      historyEntryId
    }
  }
`)

const FamilyUndoMutation = graphql(/* GraphQL */ `
  mutation AdminMapFamilyUndo($historyEntryId: UUID!) {
    mapFamilyUndo(historyEntryId: $historyEntryId) {
      historyEntryId
    }
  }
`)

const FamilyRemoveMutation = graphql(/* GraphQL */ `
  mutation AdminMapFamilyRemove($mapId: SbMapId!) {
    mapFamilyRemove(mapId: $mapId) {
      id
    }
  }
`)

const FamilyUpdateMemberMutation = graphql(/* GraphQL */ `
  mutation AdminMapFamilyUpdateMember(
    $mapId: SbMapId!
    $versionLabel: String
    $pinnedCurrent: Boolean
  ) {
    mapFamilyUpdateMember(
      mapId: $mapId
      versionLabel: $versionLabel
      pinnedCurrent: $pinnedCurrent
    ) {
      id
    }
  }
`)

const SuggestionDecideMutation = graphql(/* GraphQL */ `
  mutation AdminMapLinkSuggestionDecide(
    $mapA: SbMapId!
    $mapB: SbMapId!
    $decision: MapLinkSuggestionDecision!
  ) {
    mapLinkSuggestionDecide(mapA: $mapA, mapB: $mapB, decision: $decision) {
      id
      status
    }
  }
`)

const AddFileSearchQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyAddFileSearch($search: String!) {
    maps(filter: { search: $search, allVersions: true }, first: 8) {
      nodes {
        id
        name
        listed
      }
    }
  }
`)

const AddFileByIdQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyAddFileById($id: SbMapId!) {
    map(id: $id) {
      id
      name
      listed
    }
  }
`)

const MapFamilyHistoryQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyHistory(
    $mapIds: [SbMapId!]
    $familyIds: [UUID!]
    $actorId: SbUserId
    $undoableOnly: Boolean
    $limit: Int!
    $offset: Int!
  ) {
    mapFamilyHistory(
      mapIds: $mapIds
      familyIds: $familyIds
      actorId: $actorId
      undoableOnly: $undoableOnly
      limit: $limit
      offset: $offset
    ) {
      id
      entryId
      kind
      source
      createdAt
      labelBefore
      labelAfter
      reportStatusAfter
      actor {
        id
      }
      map {
        id
        name
      }
      otherMap {
        id
        name
      }
      memberChanges {
        id
        mapId
        map {
          id
          name
        }
        before {
          id
          parent {
            id
            name
          }
          relation
          versionLabel
          pinnedCurrent
        }
        after {
          id
          parent {
            id
            name
          }
          relation
          versionLabel
          pinnedCurrent
        }
      }
      suggestionChanges {
        id
        mapA
        mapB
        before
        after
      }
    }
  }
`)

const Content = styled.div`
  max-width: 960px;
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
  min-height: 40px;

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
  padding: 8px 16px;
`

const MutedText = styled.span`
  color: var(--theme-on-surface-variant);
`

const LoadMoreRow = styled.div`
  display: flex;
  justify-content: center;
  padding: 12px;
`

export function AdminMapFamilies() {
  const isStaff = useHasAnyPermission('manageMaps')
  return (
    <Switch>
      <Route path={`${BASE_URL}/maps/:mapId`}>
        {params => <FamilyEditorPage mapId={params.mapId} />}
      </Route>
      <Route path={`${BASE_URL}/reports`}>
        <FamilyQueue tab='reports' isStaff={isStaff} />
      </Route>
      {isStaff ? (
        <Route path={`${BASE_URL}/history`}>
          <FamilyQueue tab='history' isStaff={isStaff} />
        </Route>
      ) : null}
      <Route>
        <FamilyQueue tab='proposals' isStaff={isStaff} />
      </Route>
    </Switch>
  )
}

type QueueTab = 'proposals' | 'reports' | 'history'

const TAB_URLS: Record<QueueTab, string> = {
  proposals: BASE_URL,
  reports: `${BASE_URL}/reports`,
  history: `${BASE_URL}/history`,
}

function FamilyQueue({ tab, isStaff }: { tab: QueueTab; isStaff: boolean }) {
  // Bumped on refresh to re-mount the pages and force a fresh fetch.
  const [refreshToken, setRefreshToken] = useState(0)
  const [{ data: counts }, refetchCounts] = useQuery({
    query: MapFamilyProposalCountsQuery,
    requestPolicy: 'cache-and-network',
  })

  return (
    <Content>
      <HeadlineRow>
        <PageHeadline>Map families</PageHeadline>
        <FilledButton
          label='Refresh'
          onClick={() => {
            setRefreshToken(t => t + 1)
            refetchCounts({ requestPolicy: 'network-only' })
          }}
        />
      </HeadlineRow>
      <StyledTabs activeTab={tab} onChange={(value: QueueTab) => push(TAB_URLS[value])}>
        <TabItem
          value='proposals'
          text={`Proposals${counts ? ` (${counts.mapFamilyProposalCount})` : ''}`}
        />
        <TabItem
          value='reports'
          text={`Reports${counts ? ` (${counts.mapFamilyReportCount})` : ''}`}
        />
        {isStaff ? <TabItem value='history' text='History' /> : null}
      </StyledTabs>
      {tab === 'proposals' ? (
        <>
          <ReviewedRecently key={`recent-${refreshToken}`} />
          <ProposalsTable key={refreshToken} isStaff={isStaff} />
        </>
      ) : null}
      {tab === 'reports' ? (
        <ReportsTable
          key={refreshToken}
          isStaff={isStaff}
          onChanged={() => refetchCounts({ requestPolicy: 'network-only' })}
        />
      ) : null}
      {tab === 'history' ? <HistoryTab key={refreshToken} /> : null}
    </Content>
  )
}

/** How many of the viewer's recently saved groups the queue links back to. */
const RECENT_GROUPS = 10

const RecentRow = styled.div`
  ${bodyMedium};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin-bottom: 16px;
  color: var(--theme-on-surface-variant);
`

/** Links to the groups the viewer saved most recently, so a decision is easy to revisit. */
function ReviewedRecently() {
  const selfUser = useSelfUser()
  const [{ data }] = useQuery({
    query: MapFamilyHistoryQuery,
    variables: { actorId: selfUser?.id, limit: RECENT_GROUPS * 4, offset: 0 },
    pause: !selfUser,
    requestPolicy: 'cache-and-network',
  })

  const seen = new Set<SbMapId>()
  const recent: HistoryMapRef[] = []
  for (const entry of data?.mapFamilyHistory ?? []) {
    if (entry.map && !seen.has(entry.map.id) && recent.length < RECENT_GROUPS) {
      seen.add(entry.map.id)
      recent.push(entry.map)
    }
  }
  if (!recent.length) {
    return null
  }

  return (
    <RecentRow>
      <span>Reviewed recently:</span>
      {recent.map(map => (
        <Link key={map.id} href={editorUrl(map.id)}>
          {map.name}
        </Link>
      ))}
    </RecentRow>
  )
}

function ProposalsTable({ isStaff }: { isStaff: boolean }) {
  const [pages, setPages] = useState(1)
  return (
    <Table>
      <TableHeader>
        <Cell>Group</Cell>
        <Cell $width={96}>Files</Cell>
        <Cell $width={96}>Pairs</Cell>
        <Cell $width={120}>Families</Cell>
        <Cell $width={112}>Games</Cell>
      </TableHeader>
      {Array.from({ length: pages }, (_, i) => (
        <ProposalsPage
          key={i}
          isStaff={isStaff}
          offset={i * PAGE_SIZE}
          isLastPage={i === pages - 1}
          onLoadMore={() => setPages(p => p + 1)}
        />
      ))}
    </Table>
  )
}

function ProposalsPage({
  offset,
  isStaff,
  isLastPage,
  onLoadMore,
}: {
  offset: number
  isStaff: boolean
  isLastPage: boolean
  onLoadMore: () => void
}) {
  const [{ data, fetching, error }] = useQuery({
    query: MapFamilyProposalsQuery,
    variables: { limit: PAGE_SIZE, offset, isStaff },
    requestPolicy: 'cache-and-network',
  })
  const proposals = data?.mapFamilyProposals ?? []

  return (
    <>
      {proposals.map(p => {
        const label = p.families.find(f => f.label)?.label
        const first = p.maps[0]
        return (
          <TableRow key={p.id} onClick={() => push(editorUrl(first.id))}>
            <Cell>
              {label ?? first.name}
              {p.maps.length > 1 ? (
                <MutedText>
                  {' '}
                  · {label ? `${first.name}, ` : ''}+{p.maps.length - 1} more
                </MutedText>
              ) : null}
            </Cell>
            <Cell $width={96}>{p.maps.length}</Cell>
            <Cell $width={96}>{p.suggestions.length}</Cell>
            <Cell $width={120}>{p.families.length || '–'}</Cell>
            <Cell $width={112}>{p.games}</Cell>
          </TableRow>
        )
      })}
      {offset === 0 && data && !proposals.length ? (
        <EmptyText>Nothing to sort right now.</EmptyText>
      ) : null}
      {fetching && !data ? <LoadingDotsArea /> : null}
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {isLastPage && proposals.length === PAGE_SIZE ? (
        <LoadMoreRow>
          <OutlinedButton label='Load more' onClick={onLoadMore} />
        </LoadMoreRow>
      ) : null}
    </>
  )
}

/** Rule "review" marks a proposal a person wrote in a review rather than a detection rule. */
function ruleLabel(rule: string): string {
  return rule === 'review' ? 'proposed in review' : `rule ${rule}`
}

function reportLabel(
  kind: MapFamilyReportKind,
  otherName: string | undefined,
  relation: MapFamilyRelation | null | undefined,
): string {
  if (kind === MapFamilyReportKind.WrongFamily) {
    return 'Wrong family'
  }
  const as =
    relation && relation !== MapFamilyRelation.Root ? ` as a ${relation.toLowerCase()}` : ''
  return `Related to ${otherName ?? 'another map'}${as}`
}

function ReportsTable({ isStaff, onChanged }: { isStaff: boolean; onChanged: () => void }) {
  const [pages, setPages] = useState(1)
  return (
    <Table>
      <TableHeader>
        <Cell $width={112}>Date</Cell>
        <Cell $width={200}>Map</Cell>
        <Cell $width={240}>Report</Cell>
        <Cell>Note</Cell>
        {isStaff ? <Cell $width={140}>Reporter</Cell> : null}
        <Cell $width={56} />
      </TableHeader>
      {Array.from({ length: pages }, (_, i) => (
        <ReportsPage
          key={i}
          isStaff={isStaff}
          offset={i * PAGE_SIZE}
          isLastPage={i === pages - 1}
          onLoadMore={() => setPages(p => p + 1)}
          onChanged={onChanged}
        />
      ))}
    </Table>
  )
}

function ReportsPage({
  offset,
  isStaff,
  isLastPage,
  onLoadMore,
  onChanged,
}: {
  offset: number
  isStaff: boolean
  isLastPage: boolean
  onLoadMore: () => void
  onChanged: () => void
}) {
  const snackbarController = useSnackbarController()
  const [{ data, fetching, error }, refetch] = useQuery({
    query: MapFamilyReportsQuery,
    variables: { limit: PAGE_SIZE, offset, isStaff },
    requestPolicy: 'cache-and-network',
  })
  const [, setStatus] = useMutation(SetReportStatusMutation)
  const reports = data?.mapFamilyReports ?? []

  const close = (id: string, status: MapFamilyReportStatus) => {
    setStatus({ id, status })
      .then(result => {
        if (result.error) {
          throw result.error
        }
        refetch({ requestPolicy: 'network-only' })
        onChanged()
      })
      .catch((err: Error) => {
        snackbarController.showSnackbar(`Couldn't update the report: ${err.message}`)
      })
  }

  return (
    <>
      {reports.map(r => (
        <TableRow
          key={r.id}
          onClick={() => push(editorUrl(r.map.id, r.otherMap ? [r.otherMap.id] : []))}>
          <Cell $width={112}>
            <NarrowDuration to={new Date(r.reportedAt)} />
          </Cell>
          <Cell $width={200}>{r.map.name}</Cell>
          <Cell $width={240}>{reportLabel(r.kind, r.otherMap?.name, r.suggestedRelation)}</Cell>
          <Cell>{r.note ? r.note : <MutedText>No note</MutedText>}</Cell>
          {isStaff ? (
            <Cell $width={140}>
              {r.reportedBy ? (
                <span onClick={e => e.stopPropagation()}>
                  <ConnectedUsername userId={r.reportedBy.id} />
                </span>
              ) : (
                <MutedText>Unknown user</MutedText>
              )}
            </Cell>
          ) : null}
          <Cell $width={56} onClick={e => e.stopPropagation()}>
            <OverflowMenu
              label='Report actions'
              items={[
                ['Resolve', () => close(r.id, MapFamilyReportStatus.Resolved)],
                ['Dismiss', () => close(r.id, MapFamilyReportStatus.Dismissed)],
              ]}
            />
          </Cell>
        </TableRow>
      ))}
      {offset === 0 && data && !reports.length ? <EmptyText>No open reports.</EmptyText> : null}
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

function OverflowMenu({
  label,
  items,
  disabled,
}: {
  label: string
  items: ReadonlyArray<[text: string, handler: () => void]>
  disabled?: boolean
}) {
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  return (
    <>
      <IconButton
        ref={anchorRef}
        icon={<MaterialIcon icon='more_vert' />}
        ariaLabel={label}
        ariaHasPopup='menu'
        ariaExpanded={open}
        disabled={disabled}
        onClick={openMenu}
      />
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

// The family editor

interface FileData {
  name: string
  listed: boolean
  games: number
  ref: FragmentType<typeof AdminMapFamilies_FileFragment>
}

interface MemberInfo {
  familyId: string
  isCurrent: boolean
  pinnedCurrent: boolean
  source: MapLinkSource
  listed: boolean
}

/** The answer a file's question has in the editor. */
type FileAnswer = 'first' | 'version' | 'copy' | 'fork' | 'rejected' | 'terrainOnly'

function answerOf(placement: FamilyPlacement): FileAnswer {
  if (placement.kind === 'decided') {
    return placement.decision === MapLinkSuggestionDecision.TerrainOnly ? 'terrainOnly' : 'rejected'
  }
  switch (placement.relation) {
    case MapFamilyRelation.Root:
      return 'first'
    case MapFamilyRelation.Version:
      return 'version'
    case MapFamilyRelation.Variant:
    case MapFamilyRelation.Translation:
      return 'copy'
    case MapFamilyRelation.Fork:
      return 'fork'
    default:
      return assertUnreachable(placement.relation)
  }
}

/** How a file relates to the file it's placed under, as the start of a sentence. */
const ANSWER_PHRASES: Record<'version' | 'copy' | 'fork', string> = {
  version: 'a newer version of',
  copy: 'a copy of',
  fork: 'a different map based on',
}

/** Why the detection rules suggested a pair, by rule name. */
const RULE_REASONS: ReadonlyMap<string, string> = new Map([
  ['same_scenario', 'the same scenario data'],
  ['same_maker', 'the same name and maker'],
  ['same_name', 'the same name'],
  ['credits_original', 'its description credits the other map'],
  ['makers_differ', 'similar terrain by a different maker'],
  ['similar_terrain', 'similar terrain'],
  ['melee_and_ums', 'a UMS map on the same terrain'],
  ['ums_names_differ', 'UMS maps with different names'],
  ['review', 'a reviewer proposed it'],
])

const EditorContent = styled.div`
  max-width: 1280px;
  margin: 0 16px;
  padding-bottom: 32px;
`

const StickyHeader = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0 -16px;
  padding: 12px 16px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;

  background-color: var(--theme-container-lowest);
  border-bottom: 1px solid var(--theme-outline-variant);
`

const EditorTitle = styled.div`
  ${titleLarge};
  ${singleLine};
  min-width: 0;
  flex: 1 1 auto;

  display: flex;
  align-items: center;
  gap: 4px;
`

const TitleField = styled(TextField)`
  flex: 1 1 auto;
  max-width: 480px;
`

const LeftCount = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const UnansweredText = styled.div`
  ${bodyMedium};
  width: 100%;
  text-align: right;
  color: var(--theme-amber);
`

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  align-items: start;
  gap: 24px;
  margin-top: 16px;

  @media (max-width: 1000px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Questions = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const QuestionIntro = styled.div`
  ${titleMedium};
  display: flex;
  align-items: center;
  gap: 8px;
`

const HowToDecide = styled.div`
  ${bodyMedium};
  padding: 12px 16px;
  border-radius: 8px;
  background-color: var(--theme-container-low);

  display: flex;
  flex-direction: column;
  gap: 4px;

  & > p {
    margin: 0;
  }
`

const HowToDecideHeader = styled.div`
  ${labelLarge};
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const FileCard = styled.div<{ $latest: boolean; $unanswered: boolean }>`
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--theme-outline-variant);
  ${props => (props.$latest ? 'border-color: var(--theme-positive);' : '')}
  ${props => (props.$unanswered ? 'border-color: var(--theme-amber);' : '')}
  background-color: ${props =>
    props.$latest ? 'rgb(from var(--theme-positive) r g b / 0.06)' : 'transparent'};

  display: flex;
  gap: 16px;
`

const Thumb = styled.div`
  flex: 0 0 64px;
  width: 64px;
  height: 64px;
  border-radius: 4px;
  overflow: hidden;
`

const FileBody = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const FileTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const FileName = styled(Link)`
  ${titleMedium};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface);
`

const LatestChip = styled(RoomChip)`
  flex-shrink: 0;
  background-color: rgb(from var(--theme-positive) r g b / 0.16);
  color: var(--theme-positive);
`

const FileMeta = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
`

const DetailsIcon = styled(MaterialIcon).attrs({ icon: 'info', size: 16 })`
  display: block;
  color: var(--theme-on-surface-variant);
`

const AnswerControls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-left: 32px;
`

const ParentSelect = styled(Select)`
  width: 320px;
`

const LabelField = styled(TextField)`
  width: 120px;
`

const SuggestedText = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const FileActions = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 4px;
`

const MoreButton = styled(TextButton)`
  align-self: flex-start;
`

const SectionTitle = styled.div`
  ${titleMedium};
  margin: 16px 0 8px;
`

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const PairRow = styled.div`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 8px 4px 16px;

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }
`

const PairText = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`

const FamilyLabels = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;

  & > * {
    width: 320px;
  }
`

const AddFileField = styled(TextField)`
  max-width: 480px;
`

const SearchResults = styled.div`
  max-width: 480px;
  margin-top: 4px;
`

const SearchResult = styled.div`
  ${bodyMedium};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 8px 0 16px;
`

const PreviewPane = styled.div`
  position: sticky;
  top: 88px;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const PreviewLabel = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

const PreviewCard = styled(Card)`
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const PreviewNote = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
`

function FamilyEditorPage({ mapId: mapIdParam }: { mapId: string }) {
  const isStaff = useHasAnyPermission('manageMaps')
  const routeMapId = mapIdFromRouteSegment(mapIdParam) ?? makeSbMapId(mapIdParam)
  const [withParam, setWithParam] = useLocationSearchParam('with')
  const withIds = withParam
    ? withParam
        .split(',')
        .map(s => mapIdFromRouteSegment(s))
        .filter((id): id is SbMapId => !!id && id !== routeMapId)
    : []
  const mapIds = [routeMapId, ...new Set(withIds)]

  const [{ data, fetching, error }, refetch] = useQuery({
    query: MapFamilyGroupQuery,
    variables: { mapIds, isStaff },
    requestPolicy: 'cache-and-network',
  })

  return (
    <EditorContent>
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {!data && fetching ? <LoadingDotsArea /> : null}
      {data ? (
        <FamilyEditor
          key={routeMapId}
          group={data.mapFamilyGroup}
          mapIds={mapIds}
          isStaff={isStaff}
          onAddFile={id => setWithParam([...withIds, id].join(','))}
          refetch={() => refetch({ requestPolicy: 'network-only' })}
        />
      ) : null}
    </EditorContent>
  )
}

type GroupData = ResultOf<typeof MapFamilyGroupQuery>['mapFamilyGroup']

/** Whether a key press belongs to a text field, so the editor's shortcuts should leave it alone. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !isRadio(target) &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

/** Radio buttons don't act on Enter or letters, so the shortcuts work right after answering. */
function isRadio(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === 'radio'
}

/**
 * Whether a key press lands on a control that acts on keys itself (a button, link, select or radio
 * button), so the editor's single-key shortcuts shouldn't take it over.
 */
function isControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !isRadio(target) &&
    !!target.closest('button, a, input, textarea, select, [role], [tabindex], [contenteditable]')
  )
}

function FamilyEditor({
  group,
  mapIds,
  isStaff,
  onAddFile,
  refetch,
}: {
  group: GroupData
  mapIds: ReadonlyArray<SbMapId>
  isStaff: boolean
  onAddFile: (id: SbMapId) => void
  refetch: () => void
}) {
  const client = useClient()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()
  const skippedMapIds = useAtomValue(skippedMapIdsAtom)
  const draftKey = mapIds[0]
  const [draft, setDraft] = useAtom(editorDraftAtom)
  const edits = draft?.key === draftKey ? draft.edits : NO_EDITS
  const familyLabels = draft?.key === draftKey ? draft.familyLabels : NO_LABEL_EDITS
  const setEdits = (newEdits: ReadonlyMap<SbMapId, FamilyPlacement>) =>
    setDraft(d => ({
      key: draftKey,
      edits: newEdits,
      familyLabels: d?.key === draftKey ? d.familyLabels : NO_LABEL_EDITS,
    }))
  const setFamilyLabels = (newLabels: ReadonlyMap<string, string>) =>
    setDraft(d => ({
      key: draftKey,
      edits: d?.key === draftKey ? d.edits : NO_EDITS,
      familyLabels: newLabels,
    }))
  const [applying, setApplying] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [howToDecideSeen, setHowToDecideSeen] = useUserLocalStorageValue(
    'mapFamilies.howToDecideSeen',
    false,
  )
  const [showHowToDecide, setShowHowToDecide] = useState(!howToDecideSeen)

  const [{ data: counts }] = useQuery({
    query: MapFamilyProposalCountsQuery,
    requestPolicy: 'cache-and-network',
  })
  const [, apply] = useMutation(FamilyApplyMutation)
  const [, undo] = useMutation(FamilyUndoMutation)
  const [, removeMember] = useMutation(FamilyRemoveMutation)
  const [, updateMember] = useMutation(FamilyUpdateMemberMutation)
  const [, decide] = useMutation(SuggestionDecideMutation)

  const fileData = new Map<SbMapId, FileData>()
  const members = new Map<SbMapId, MemberInfo>()
  const files: FamilyEditorFile[] = []
  for (const family of group.families) {
    for (const member of family.members) {
      fileData.set(member.mapId, {
        name: member.map.name,
        listed: member.map.listed,
        games: member.map.stats?.gamesTotal ?? 0,
        ref: member.map,
      })
      members.set(member.mapId, {
        familyId: family.familyId,
        isCurrent: member.isCurrent,
        pinnedCurrent: member.pinnedCurrent,
        source: member.source,
        listed: member.map.listed,
      })
      files.push({
        id: member.mapId,
        inFamily: true,
        firstSeenAt: Date.parse(member.map.firstSeenAt),
        initial: {
          kind: 'tree',
          parentId: member.parentId ?? undefined,
          relation: member.relation,
          versionLabel: member.versionLabel ?? '',
        },
      })
    }
  }
  const proposed = new Map(group.proposedLinks.map(l => [l.mapId, l]))
  for (const map of group.maps) {
    if (members.has(map.id)) {
      continue
    }
    fileData.set(map.id, {
      name: map.name,
      listed: map.listed,
      games: map.stats?.gamesTotal ?? 0,
      ref: map,
    })
    const proposal = proposed.get(map.id)
    files.push({
      id: map.id,
      inFamily: false,
      firstSeenAt: Date.parse(map.firstSeenAt),
      initial: {
        kind: 'tree',
        parentId: proposal?.parentId ?? undefined,
        relation: proposal?.relation ?? MapFamilyRelation.Root,
        versionLabel: proposal?.versionLabel ?? '',
      },
    })
  }

  const placements: FamilyPlacements = new Map(files.map(f => [f.id, edits.get(f.id) ?? f.initial]))
  const openPairs = group.suggestions.map(s => ({ mapA: s.mapA.id, mapB: s.mapB.id }))
  const plan = planFamilyEdits(files, placements, openPairs)
  const unanswered = unansweredFiles(placements, openPairs)
  const labelEdits = Array.from(familyLabels.entries()).filter(
    ([familyId, label]) =>
      label.trim() !== (group.families.find(f => f.familyId === familyId)?.label ?? ''),
  )
  /** Whether saving would change anything (accepting the proposed tree as it is counts). */
  const dirty = hasFamilyEdits(plan) || labelEdits.length > 0
  /** Whether anything the queue proposed was changed. */
  const edited = edits.size > 0 || labelEdits.length > 0
  const nameOf = (id: SbMapId) => fileData.get(id)?.name ?? 'Unknown map'

  const rows = orderRows(files, placements)
  const firstFamily = group.families.length === 1 ? group.families[0] : undefined
  const savedTitle =
    group.families.find(f => f.label)?.label ?? (rows.length ? nameOf(rows[0].id) : 'Map family')
  const title = firstFamily
    ? (familyLabels.get(firstFamily.familyId) ?? firstFamily.label ?? '') || savedTitle
    : savedTitle

  const showError = (action: string, err: unknown) => {
    snackbarController.showSnackbar(
      `${action}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const goToNext = async (skip: boolean) => {
    const groupIds = new Set(files.map(f => f.id))
    let skipped = skippedMapIds
    if (skip) {
      skipped = new Set([...skippedMapIds, ...groupIds])
      jotaiStore.set(skippedMapIdsAtom, skipped)
    }
    const result = await client
      .query(NextProposalsQuery, { limit: NEXT_LOOKAHEAD }, { requestPolicy: 'network-only' })
      .toPromise()
    if (result.error) {
      throw result.error
    }
    const next = result.data?.mapFamilyProposals.find(
      p => !p.maps.some(m => groupIds.has(m.id) || skipped.has(m.id)),
    )
    push(next ? editorUrl(next.maps[0].id) : BASE_URL)
  }

  /** Reverts the save that recorded `historyEntryId` and reopens its files in the editor. */
  const undoSave = async (historyEntryId: string, mapId: SbMapId | undefined) => {
    const result = await undo({ historyEntryId })
    if (result.error) {
      throw result.error
    }
    snackbarController.showSnackbar('Save undone')
    // Compared with the current page rather than this editor's group, since this can run after
    // the editor moved on to the next group
    if (mapId && window.location.pathname !== editorUrl(mapId)) {
      push(editorUrl(mapId))
    } else {
      refetch()
    }
  }

  const onUndoLast = async () => {
    if (!selfUser) {
      return
    }
    const result = await client
      .query(
        MapFamilyHistoryQuery,
        { actorId: selfUser.id, undoableOnly: true, limit: 1, offset: 0 },
        { requestPolicy: 'network-only' },
      )
      .toPromise()
    if (result.error) {
      throw result.error
    }
    const last = result.data?.mapFamilyHistory[0]
    if (!last) {
      snackbarController.showSnackbar('Nothing to undo')
      return
    }
    await undoSave(last.entryId, last.map?.id)
  }

  const onSave = async () => {
    setApplying(true)
    let historyEntryId: string | null | undefined
    try {
      const result = await apply({
        input: {
          links: plan.links,
          versionLabels: plan.labels,
          decisions: plan.decisions,
          familyLabels: labelEdits.map(([familyId, label]) => ({
            familyId,
            label: label.trim() || null,
          })),
        },
      })
      if (result.error) {
        throw result.error
      }
      historyEntryId = result.data?.mapFamilyApply.historyEntryId
    } catch (err) {
      showError("Couldn't save", err)
      setApplying(false)
      return
    }

    setEdits(new Map())
    setFamilyLabels(new Map())
    setEditingTitle(false)
    snackbarController.showSnackbar(`Saved ${title}`, DURATION_LONG, {
      action: historyEntryId
        ? {
            label: 'Undo',
            onClick: () => {
              undoSave(historyEntryId!, draftKey).catch(err => showError("Couldn't undo", err))
            },
          }
        : undefined,
    })
    try {
      if (unanswered.size > 0) {
        refetch()
      } else {
        await goToNext(false)
      }
    } catch (err) {
      showError("Couldn't load the next group", err)
    } finally {
      setApplying(false)
    }
  }

  const onImmediate = (action: string, promise: Promise<{ error?: Error }>) => {
    promise
      .then(result => {
        if (result.error) {
          throw result.error
        }
        refetch()
      })
      .catch(err => showError(action, err))
  }

  const onSkip = () => {
    goToNext(true).catch(err => showError("Couldn't load the next group", err))
  }
  let primaryLabel = 'Next'
  if (dirty) {
    primaryLabel = unanswered.size ? 'Save' : 'Save & next'
  }
  const onPrimary = () => {
    if (dirty) {
      onSave().catch(err => showError("Couldn't save", err))
    } else {
      goToNext(true).catch(err => showError("Couldn't load the next group", err))
    }
  }
  useKeyListener({
    onKeyDown: event => {
      if (applying || isTypingTarget(event.target) || event.altKey || event.metaKey) {
        return false
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        onUndoLast().catch(err => showError("Couldn't undo", err))
        return true
      } else if (event.ctrlKey || event.shiftKey || isControlTarget(event.target)) {
        return false
      } else if (event.key.toLowerCase() === 's') {
        onSkip()
        return true
      } else if (event.key === 'Enter') {
        onPrimary()
        return true
      }
      return false
    },
  })

  // What players will see once this is saved
  const treeFiles = files.filter(f => placements.get(f.id)?.kind === 'tree')
  const previewMembers: PreviewMember[] = treeFiles.map(f => {
    const placement = placements.get(f.id) as Extract<FamilyPlacement, { kind: 'tree' }>
    const member = members.get(f.id)
    return {
      mapId: f.id,
      parentId: placement.parentId,
      relation: placement.relation,
      versionLabel: placement.versionLabel.trim() || undefined,
      pinnedCurrent: !!member?.pinnedCurrent,
      listed: fileData.get(f.id)!.listed,
      firstSeenAt: f.firstSeenAt,
    }
  })
  const previewPlaces = previewFamily(previewMembers)
  const trees = new Map<SbMapId, PreviewMember[]>()
  for (const m of previewMembers) {
    let top = m
    for (let steps = 0; top.parentId && steps <= previewMembers.length; steps++) {
      top = previewMembers.find(p => p.mapId === top.parentId) ?? top
    }
    trees.set(top.mapId, [...(trees.get(top.mapId) ?? []), m])
  }
  const families = Array.from(trees.values()).filter(t => t.length >= 2)
  const alone = files.filter(f => {
    const placement = placements.get(f.id)!
    return placement.kind !== 'tree' || trees.get(f.id)?.length === 1
  })
  const catalogTiles = previewMembers
    .filter(m => previewPlaces.get(m.mapId)?.isCurrent && m.listed)
    .map(m => m.mapId)
    .concat(alone.map(f => f.id).filter(id => fileData.get(id)!.listed))

  const parentPicks = (id: SbMapId) => parentOptions(placements, id)

  return (
    <>
      <StickyHeader>
        <TextButton label='Queue' iconStart='arrow_back' onClick={() => push(BASE_URL)} />
        <EditorTitle>
          {editingTitle && firstFamily ? (
            <TitleField
              label='Family label (staff only)'
              dense={true}
              allowErrors={false}
              inputProps={{ autoFocus: true }}
              value={familyLabels.get(firstFamily.familyId) ?? firstFamily.label ?? ''}
              onChange={e =>
                setFamilyLabels(new Map(familyLabels).set(firstFamily.familyId, e.target.value))
              }
              onBlur={() => setEditingTitle(false)}
            />
          ) : (
            <>
              <span title={title}>{title}</span>
              {isStaff && firstFamily ? (
                <Tooltip text='Edit label' position='bottom' tabIndex={-1}>
                  <IconButton
                    icon={<MaterialIcon icon='edit' size={20} />}
                    ariaLabel='Edit label'
                    onClick={() => setEditingTitle(true)}
                  />
                </Tooltip>
              ) : null}
            </>
          )}
        </EditorTitle>
        {counts ? <LeftCount>{counts.mapFamilyProposalCount} left</LeftCount> : null}
        {edited ? (
          <TextButton
            label='Reset'
            disabled={applying}
            onClick={() => {
              setEdits(new Map())
              setFamilyLabels(new Map())
            }}
          />
        ) : null}
        <Tooltip text='Skip (S)' position='bottom' tabIndex={-1}>
          <TextButton label='Skip' disabled={applying} onClick={onSkip} />
        </Tooltip>
        <Tooltip text='Undo your last save (Ctrl+Z)' position='bottom' tabIndex={-1}>
          <OutlinedButton
            label='Undo last'
            iconStart='undo'
            disabled={applying}
            onClick={() => {
              onUndoLast().catch(err => showError("Couldn't undo", err))
            }}
          />
        </Tooltip>
        <Tooltip text='Enter' position='bottom' tabIndex={-1}>
          <FilledButton label={primaryLabel} disabled={applying} onClick={onPrimary} />
        </Tooltip>
        {unanswered.size ? (
          <UnansweredText>
            {unanswered.size} {unanswered.size === 1 ? 'file still needs' : 'files still need'} an
            answer
          </UnansweredText>
        ) : null}
      </StickyHeader>

      <Columns>
        <Questions>
          <QuestionIntro>
            Is each file a version, a copy, or a different map?
            {showHowToDecide ? null : (
              <TextButton label='How to decide' onClick={() => setShowHowToDecide(true)} />
            )}
          </QuestionIntro>
          {showHowToDecide ? (
            <HowToDecide>
              <HowToDecideHeader>
                How to decide
                <IconButton
                  icon={<MaterialIcon icon='close' size={20} />}
                  ariaLabel='Close'
                  onClick={() => {
                    setShowHowToDecide(false)
                    setHowToDecideSeen(true)
                  }}
                />
              </HowToDecideHeader>
              <p>
                <strong>Version:</strong> the same map, released again with a newer number (Fighting
                Spirit 1.1 → 1.3).
              </p>
              <p>
                <strong>Copy:</strong> the same version with small changes: an observer or
                tournament edit, a re-save, a translation (Fighting Spirit 1.3 obs).
              </p>
              <p>
                <strong>Based on:</strong> a different map made from it, usually by someone else
                (Neo Fighting Spirit).
              </p>
              <p>
                <strong>Not related:</strong> not the same map, including a UMS map built on its
                terrain.
              </p>
            </HowToDecide>
          ) : null}

          {rows.map(row => {
            const file = files.find(f => f.id === row.id)!
            return (
              <FamilyFileCard
                key={row.id}
                file={file}
                data={fileData.get(row.id)!.ref}
                member={members.get(row.id)}
                placement={placements.get(row.id)!}
                isLatest={!!previewPlaces.get(row.id)?.isCurrent}
                unanswered={unanswered.has(row.id)}
                suggestion={group.suggestions.find(s => {
                  const initialParent =
                    file.initial.kind === 'tree' ? file.initial.parentId : undefined
                  return (
                    !file.inFamily &&
                    initialParent &&
                    ((s.mapA.id === file.id && s.mapB.id === initialParent) ||
                      (s.mapB.id === file.id && s.mapA.id === initialParent))
                  )
                })}
                parentOptions={parentPicks(row.id)}
                nameOf={nameOf}
                isStaff={isStaff}
                actionsDisabled={edited || applying}
                onChange={placement => setEdits(placeFile(placements, row.id, placement))}
                onPin={pinned =>
                  onImmediate(
                    "Couldn't change the latest version",
                    updateMember({ mapId: row.id, pinnedCurrent: pinned }),
                  )
                }
                onRemove={() =>
                  onImmediate("Couldn't remove the map", removeMember({ mapId: row.id }))
                }
              />
            )
          })}

          <MoreButton
            label={showMore ? 'Less' : 'More: add a file, open pairs, history'}
            iconEnd={<MaterialIcon icon={showMore ? 'expand_less' : 'expand_more'} />}
            onClick={() => setShowMore(!showMore)}
          />
          {showMore ? (
            <div>
              <SectionTitle>Add a file</SectionTitle>
              <AddFile present={new Set(files.map(f => f.id))} onAdd={onAddFile} />

              {isStaff && group.families.length > 1 ? (
                <>
                  <SectionTitle>Family labels</SectionTitle>
                  <FamilyLabels>
                    {group.families.map(family => {
                      const top = family.members.find(m => !m.parentId)
                      return (
                        <TextField
                          key={family.familyId}
                          label={top ? `Label (family of ${top.map.name})` : 'Family label'}
                          dense={true}
                          allowErrors={false}
                          value={familyLabels.get(family.familyId) ?? family.label ?? ''}
                          onChange={e =>
                            setFamilyLabels(
                              new Map(familyLabels).set(family.familyId, e.target.value),
                            )
                          }
                        />
                      )
                    })}
                  </FamilyLabels>
                </>
              ) : null}

              {isStaff && group.suggestions.length ? (
                <>
                  <SectionTitle>Open pairs ({group.suggestions.length})</SectionTitle>
                  <Rows>
                    {group.suggestions.map(s => {
                      const older = s.olderMapId ?? s.mapA.id
                      const newer = older === s.mapA.id ? s.mapB.id : s.mapA.id
                      const facts = [
                        s.proposedRelation
                          ? PROPOSED_RELATION_LABELS[s.proposedRelation]
                          : 'no proposal',
                        s.rule ? ruleLabel(s.rule) : undefined,
                        s.terrainSimilarity !== null && s.terrainSimilarity !== undefined
                          ? `${Math.round(s.terrainSimilarity * 100)}% terrain`
                          : undefined,
                        s.nameMatch ? 'same name' : undefined,
                      ].filter(Boolean)
                      return (
                        <PairRow key={s.id}>
                          <PairText>
                            {nameOf(older)} → {nameOf(newer)}{' '}
                            <MutedText>· {facts.join(' · ')}</MutedText>
                          </PairText>
                          <Tooltip text='Compare' position='bottom' tabIndex={-1}>
                            <LinkButton href={urlForMapCompare(older, newer)}>
                              <IconButton
                                styledAs='div'
                                icon={<MaterialIcon icon='compare' />}
                                ariaLabel='Compare'
                              />
                            </LinkButton>
                          </Tooltip>
                          <OverflowMenu
                            label='Pair actions'
                            disabled={applying}
                            items={[
                              [
                                'Not related',
                                () =>
                                  onImmediate(
                                    "Couldn't close the pair",
                                    decide({
                                      mapA: s.mapA.id,
                                      mapB: s.mapB.id,
                                      decision: MapLinkSuggestionDecision.Rejected,
                                    }),
                                  ),
                              ],
                              [
                                'UMS map on the same terrain',
                                () =>
                                  onImmediate(
                                    "Couldn't close the pair",
                                    decide({
                                      mapA: s.mapA.id,
                                      mapB: s.mapB.id,
                                      decision: MapLinkSuggestionDecision.TerrainOnly,
                                    }),
                                  ),
                              ],
                            ]}
                          />
                        </PairRow>
                      )
                    })}
                  </Rows>
                </>
              ) : null}

              {isStaff ? (
                <>
                  <SectionTitle>History</SectionTitle>
                  <HistoryList
                    mapIds={files.map(f => f.id)}
                    familyIds={group.families.map(f => f.familyId)}
                    actorId={undefined}
                    pageSize={EDITOR_HISTORY_PAGE_SIZE}
                    onActor={undefined}
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </Questions>

        <PreviewPane>
          <PreviewLabel>Players will see</PreviewLabel>
          {families.length ? (
            families.map(tree => (
              <PreviewCard key={tree[0].mapId}>
                <FamilyVersionsList
                  linkMaps={false}
                  members={tree.map(m => {
                    const place = previewPlaces.get(m.mapId)!
                    return {
                      mapId: m.mapId,
                      parentId: m.parentId,
                      relation: m.relation,
                      versionLabel: m.versionLabel,
                      isCurrent: place.isCurrent,
                      status: place.status,
                      name: nameOf(m.mapId),
                      games: fileData.get(m.mapId)!.games,
                      firstSeenAt: new Date(m.firstSeenAt).toISOString(),
                    }
                  })}
                />
              </PreviewCard>
            ))
          ) : (
            <PreviewNote>No versions: every file stands on its own.</PreviewNote>
          )}
          <PreviewNote>
            Catalog: {catalogTiles.length} {catalogTiles.length === 1 ? 'tile' : 'tiles'}
            {catalogTiles.length ? ` (${catalogTiles.map(nameOf).join(', ')})` : ''}
          </PreviewNote>
          {alone.length ? (
            <PreviewNote>On their own: {alone.map(f => nameOf(f.id)).join(', ')}</PreviewNote>
          ) : null}
        </PreviewPane>
      </Columns>
    </>
  )
}

function FamilyFileCard({
  file,
  data: dataRef,
  member,
  placement,
  isLatest,
  unanswered,
  suggestion,
  parentOptions,
  nameOf,
  isStaff,
  actionsDisabled,
  onChange,
  onPin,
  onRemove,
}: {
  file: FamilyEditorFile
  data: FragmentType<typeof AdminMapFamilies_FileFragment>
  member: MemberInfo | undefined
  placement: FamilyPlacement
  isLatest: boolean
  unanswered: boolean
  suggestion: GroupData['suggestions'][number] | undefined
  parentOptions: SbMapId[]
  nameOf: (id: SbMapId) => string
  isStaff: boolean
  actionsDisabled: boolean
  onChange: (placement: FamilyPlacement) => void
  onPin: (pinned: boolean) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat(firstSeenFormat)
  const data = useFragment(AdminMapFamilies_FileFragment, dataRef)

  const isInitialTop = file.initial.kind === 'tree' && !file.initial.parentId
  const canBeFirst = !file.inFamily || isInitialTop
  const answer = answerOf(placement)
  const versionLabel = placement.kind === 'tree' ? placement.versionLabel : ''
  const parentId = placement.kind === 'tree' ? placement.parentId : undefined

  const relationFor = (value: 'version' | 'copy' | 'fork', parent: SbMapId) => {
    switch (value) {
      case 'version':
        return MapFamilyRelation.Version
      case 'copy':
        // A copy staff already marked as a translation stays one
        return placement.kind === 'tree' && placement.relation === MapFamilyRelation.Translation
          ? MapFamilyRelation.Translation
          : copyRelation(data.name, nameOf(parent))
      case 'fork':
        return MapFamilyRelation.Fork
      default:
        return assertUnreachable(value)
    }
  }

  const onAnswer = (value: FileAnswer) => {
    if (value === 'rejected' || value === 'terrainOnly') {
      onChange({
        kind: 'decided',
        decision:
          value === 'rejected'
            ? MapLinkSuggestionDecision.Rejected
            : MapLinkSuggestionDecision.TerrainOnly,
      })
    } else if (value === 'first') {
      onChange({
        kind: 'tree',
        parentId: undefined,
        relation: MapFamilyRelation.Root,
        versionLabel,
      })
    } else {
      const parent = parentId ?? parentOptions[0]
      if (!parent) {
        return
      }
      onChange({
        kind: 'tree',
        parentId: parent,
        relation: relationFor(value, parent),
        versionLabel,
      })
    }
  }
  const games = data.stats?.gamesTotal ?? 0
  const makers = data.file.analysis?.makers ?? []
  const credited = data.file.analysis?.credited ?? []
  const meta = [
    `${games} ${games === 1 ? 'game' : 'games'}`,
    makers.length ? `by ${makers.join(', ')}` : undefined,
  ].filter(Boolean)
  const details = [
    `${data.file.width}×${data.file.height} ${tilesetToName(data.file.tileset as Tileset, t)}`,
    `First seen ${format.format(new Date(data.firstSeenAt))}`,
    credited.length ? `Credits: ${credited.join(', ')}` : undefined,
    member ? SOURCE_LABELS[member.source] : 'Not in a family yet',
  ].filter(Boolean)

  let suggestedText: string | undefined
  if (suggestion && file.initial.kind === 'tree' && file.initial.parentId) {
    const initialAnswer = answerOf(file.initial)
    const phrase =
      initialAnswer === 'version' || initialAnswer === 'copy' || initialAnswer === 'fork'
        ? ANSWER_PHRASES[initialAnswer]
        : undefined
    const reason = suggestion.rule ? RULE_REASONS.get(suggestion.rule) : undefined
    if (phrase) {
      suggestedText =
        `Suggested: ${phrase} ${nameOf(file.initial.parentId)}` + (reason ? `, ${reason}.` : '.')
    }
  }

  const menuItems: Array<[string, () => void]> = []
  if (member) {
    if (member.listed && !member.pinnedCurrent) {
      menuItems.push(['Pin as Latest', () => onPin(true)])
    } else if (member.pinnedCurrent) {
      menuItems.push(['Unpin as Latest', () => onPin(false)])
    }
    menuItems.push(['Remove from family', onRemove])
  }

  return (
    <FileCard $latest={isLatest} $unanswered={unanswered}>
      <Thumb>
        <MapFileImage file={data.file} name={data.name} size={64} />
      </Thumb>
      <FileBody>
        <FileTitle>
          <FileName href={urlForMap(data.id, data.name)}>{data.name}</FileName>
          {isLatest ? <LatestChip>Latest</LatestChip> : null}
          {!data.listed ? <RoomChip>Unlisted</RoomChip> : null}
          {data.official ? <RoomChip>Official</RoomChip> : null}
          <Tooltip text={details.join(' · ')} position='bottom'>
            <DetailsIcon />
          </Tooltip>
        </FileTitle>
        <FileMeta>{meta.join(' · ')}</FileMeta>
        <RadioGroup
          value={answer}
          dense={true}
          onChange={e => onAnswer(e.target.value as FileAnswer)}>
          {canBeFirst ? <RadioButton label='The first version' value='first' /> : null}
          <RadioButton
            label='A newer version of…'
            value='version'
            disabled={!parentOptions.length}
          />
          <RadioButton label='A copy of…' value='copy' disabled={!parentOptions.length} />
          <RadioButton
            label='A different map based on…'
            value='fork'
            disabled={!parentOptions.length}
          />
          {!file.inFamily ? <RadioButton label='Not related' value='rejected' /> : null}
          {!file.inFamily && isStaff ? (
            <RadioButton label='Not related: a UMS map on the same terrain' value='terrainOnly' />
          ) : null}
        </RadioGroup>
        {placement.kind === 'tree' ? (
          <AnswerControls>
            {parentId ? (
              <ParentSelect
                value={parentId}
                dense={true}
                allowErrors={false}
                ariaLabel='Of which file'
                onChange={(parent: SbMapId) =>
                  onChange({
                    ...placement,
                    parentId: parent,
                    relation:
                      answer === 'version' || answer === 'copy' || answer === 'fork'
                        ? relationFor(answer, parent)
                        : placement.relation,
                  })
                }>
                {parentOptions.map(id => (
                  <SelectOption key={id} value={id} text={nameOf(id)} />
                ))}
              </ParentSelect>
            ) : null}
            <LabelField
              label='Version'
              dense={true}
              allowErrors={false}
              value={placement.versionLabel}
              onChange={e => onChange({ ...placement, versionLabel: e.target.value })}
            />
          </AnswerControls>
        ) : null}
        {suggestedText ? <SuggestedText>{suggestedText}</SuggestedText> : null}
      </FileBody>
      <FileActions>
        {parentId ? (
          <Tooltip text='Compare with the file it’s placed under' position='bottom' tabIndex={-1}>
            <LinkButton href={urlForMapCompare(parentId, file.id)}>
              <IconButton
                styledAs='div'
                icon={<MaterialIcon icon='compare' />}
                ariaLabel='Compare with the file it’s placed under'
              />
            </LinkButton>
          </Tooltip>
        ) : null}
        {menuItems.length ? (
          <OverflowMenu label='File actions' items={menuItems} disabled={actionsDisabled} />
        ) : null}
      </FileActions>
    </FileCard>
  )
}

const firstSeenFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

function AddFile({
  present,
  onAdd,
}: {
  present: ReadonlySet<SbMapId>
  onAdd: (id: SbMapId) => void
}) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  // A pasted map page URL or id looks the map up directly, which also finds unlisted maps
  const urlSegment = /\/maps\/([^/?#]+)/.exec(trimmed)?.[1] ?? trimmed
  const pastedId = trimmed ? mapIdFromRouteSegment(urlSegment) : undefined

  const [{ data: byId }] = useQuery({
    query: AddFileByIdQuery,
    variables: { id: pastedId ?? ('' as SbMapId) },
    pause: !pastedId,
  })
  const [{ data: bySearch, fetching }] = useQuery({
    query: AddFileSearchQuery,
    variables: { search: trimmed },
    pause: !trimmed || !!pastedId,
  })

  let results: ReadonlyArray<{ id: SbMapId; name: string; listed: boolean }> = []
  if (pastedId) {
    results = byId?.map ? [byId.map] : []
  } else if (trimmed) {
    results = bySearch?.maps.nodes ?? []
  }

  return (
    <>
      <AddFileField
        label='Search listed maps, or paste a map link or id'
        dense={true}
        allowErrors={false}
        hasClearButton={true}
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      {trimmed ? (
        <SearchResults>
          {results.map(m => (
            <SearchResult key={m.id}>
              <span>
                {m.name}
                {!m.listed ? <MutedText> · unlisted</MutedText> : null}
              </span>
              <TextButton
                label={present.has(m.id) ? 'Added' : 'Add'}
                disabled={present.has(m.id)}
                onClick={() => {
                  onAdd(m.id)
                  setValue('')
                }}
              />
            </SearchResult>
          ))}
          {!results.length && !fetching ? <MutedText>No maps found.</MutedText> : null}
        </SearchResults>
      ) : null}
    </>
  )
}

// History

const HistoryItem = styled.div`
  ${bodyMedium};
  padding: 8px 16px;

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }
`

const HistoryLine = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const HistoryTime = styled.div`
  ${bodySmall};
  flex: 0 0 120px;
  color: var(--theme-on-surface-variant);
`

const HistoryActor = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
`

const HistorySummary = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
`

const HistoryDetails = styled(FileMeta)`
  margin: 4px 0 4px 132px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const FilterBar = styled.div`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
`

const SOURCE_CHIP_LABELS: Record<MapLinkSource, string> = {
  [MapLinkSource.Rule]: 'Rule',
  [MapLinkSource.Publisher]: 'Publisher',
  [MapLinkSource.Reviewer]: 'Reviewer',
  [MapLinkSource.Moderator]: 'Staff',
}

const SUGGESTION_STATUS_LABELS: Record<MapLinkSuggestionStatus, string> = {
  [MapLinkSuggestionStatus.Open]: 'Open',
  [MapLinkSuggestionStatus.Accepted]: 'Linked',
  [MapLinkSuggestionStatus.Rejected]: 'Not related',
  [MapLinkSuggestionStatus.TerrainOnly]: 'Terrain only',
}

type HistoryEntry = ResultOf<typeof MapFamilyHistoryQuery>['mapFamilyHistory'][number]
type HistoryMapRef = { id: SbMapId; name: string }
type HistoryMemberState = NonNullable<HistoryEntry['memberChanges'][number]['before']>

function HistoryTab() {
  const [actorParam, setActorParam] = useLocationSearchParam('by')
  const actorId = actorParam ? (Number(actorParam) as SbUserId) : undefined

  return (
    <>
      {actorId ? (
        <FilterBar>
          <span>Changes by</span>
          <ConnectedUsername userId={actorId} />
          <TextButton label='Clear' onClick={() => setActorParam('')} />
        </FilterBar>
      ) : null}
      <HistoryList
        mapIds={undefined}
        familyIds={undefined}
        pageSize={PAGE_SIZE}
        actorId={actorId}
        onActor={id => setActorParam(String(id))}
      />
    </>
  )
}

function HistoryList({
  mapIds,
  familyIds,
  actorId,
  pageSize,
  onActor,
}: {
  mapIds: ReadonlyArray<SbMapId> | undefined
  familyIds: ReadonlyArray<string> | undefined
  actorId: SbUserId | undefined
  pageSize: number
  onActor: ((userId: SbUserId) => void) | undefined
}) {
  const [pages, setPages] = useState(1)
  return (
    <Rows>
      {Array.from({ length: pages }, (_, i) => (
        <HistoryPage
          key={i}
          mapIds={mapIds}
          familyIds={familyIds}
          actorId={actorId}
          pageSize={pageSize}
          offset={i * pageSize}
          isLastPage={i === pages - 1}
          onLoadMore={() => setPages(p => p + 1)}
          onActor={onActor}
        />
      ))}
    </Rows>
  )
}

function HistoryPage({
  mapIds,
  familyIds,
  actorId,
  pageSize,
  offset,
  isLastPage,
  onLoadMore,
  onActor,
}: {
  mapIds: ReadonlyArray<SbMapId> | undefined
  familyIds: ReadonlyArray<string> | undefined
  actorId: SbUserId | undefined
  pageSize: number
  offset: number
  isLastPage: boolean
  onLoadMore: () => void
  onActor: ((userId: SbUserId) => void) | undefined
}) {
  const [{ data, fetching, error }] = useQuery({
    query: MapFamilyHistoryQuery,
    variables: {
      mapIds: mapIds ? [...mapIds] : undefined,
      familyIds: familyIds?.length ? [...familyIds] : undefined,
      actorId,
      limit: pageSize,
      offset,
    },
    requestPolicy: 'cache-and-network',
  })
  const entries = data?.mapFamilyHistory ?? []

  return (
    <>
      {entries.map(entry => (
        <HistoryRow key={entry.id} entry={entry} onActor={onActor} />
      ))}
      {offset === 0 && data && !entries.length ? <EmptyText>No changes yet.</EmptyText> : null}
      {fetching && !data ? <LoadingDotsArea /> : null}
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {isLastPage && entries.length === pageSize ? (
        <LoadMoreRow>
          <OutlinedButton label='Load more' onClick={onLoadMore} />
        </LoadMoreRow>
      ) : null}
    </>
  )
}

function MapLink({ map }: { map: HistoryMapRef | null | undefined }) {
  return map ? <Link href={editorUrl(map.id)}>{map.name}</Link> : <MutedText>a map</MutedText>
}

/** How a history entry says what a file was placed as. */
const HISTORY_RELATION_PHRASES: Record<MapFamilyRelation, string> = {
  [MapFamilyRelation.Root]: '',
  [MapFamilyRelation.Version]: ' as a newer version',
  [MapFamilyRelation.Variant]: ' as a copy',
  [MapFamilyRelation.Translation]: ' as a translation',
  [MapFamilyRelation.Fork]: ' as a map based on it',
}

function describeMemberState(state: HistoryMemberState | null): string {
  if (!state) {
    return 'not in a family'
  }
  return [
    state.parent?.name ?? '—',
    RELATION_LABELS[state.relation],
    state.versionLabel ? `version ${state.versionLabel}` : undefined,
    state.pinnedCurrent ? 'pinned' : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

function HistoryRow({
  entry,
  onActor,
}: {
  entry: HistoryEntry
  onActor: ((userId: SbUserId) => void) | undefined
}) {
  const format = useFormat(shortTimestamp)
  const [expanded, setExpanded] = useState(false)

  return (
    <HistoryItem>
      <HistoryLine>
        <HistoryTime>{format.format(new Date(entry.createdAt))}</HistoryTime>
        <HistoryActor>
          {entry.actor ? (
            <>
              <ConnectedUsername userId={entry.actor.id} />
              {onActor ? (
                <Tooltip text='Only changes by this person' position='bottom' tabIndex={-1}>
                  <IconButton
                    icon={<MaterialIcon icon='filter_alt' />}
                    ariaLabel='Only changes by this person'
                    onClick={() => onActor(entry.actor!.id)}
                  />
                </Tooltip>
              ) : null}
            </>
          ) : (
            <MutedText>System</MutedText>
          )}
          <RoomChip>{SOURCE_CHIP_LABELS[entry.source]}</RoomChip>
        </HistoryActor>
        <HistorySummary>
          <HistorySummaryText entry={entry} />
        </HistorySummary>
        {entry.memberChanges.length ? (
          <IconButton
            icon={<MaterialIcon icon={expanded ? 'expand_less' : 'expand_more'} />}
            ariaLabel={expanded ? 'Hide file changes' : 'Show file changes'}
            onClick={() => setExpanded(e => !e)}
          />
        ) : null}
      </HistoryLine>
      {expanded ? (
        <HistoryDetails>
          {entry.memberChanges.map(c => (
            <div key={c.id}>
              <MapLink map={c.map} />: {describeMemberState(c.before ?? null)} →{' '}
              {describeMemberState(c.after ?? null)}
            </div>
          ))}
        </HistoryDetails>
      ) : null}
    </HistoryItem>
  )
}

function HistorySummaryText({ entry }: { entry: HistoryEntry }) {
  const { map, otherMap } = entry
  const others = entry.memberChanges.filter(c => c.mapId !== map?.id).length
  const accepted = entry.suggestionChanges.filter(
    c => c.after === MapLinkSuggestionStatus.Accepted,
  ).length
  const rejected = entry.suggestionChanges.filter(
    c => c.after === MapLinkSuggestionStatus.Rejected,
  ).length
  const counts = (suggestionVerb: string, suggestions: number) =>
    [
      others ? `${others} other ${others === 1 ? 'file' : 'files'} changed` : undefined,
      suggestions
        ? `${suggestions} ${suggestions === 1 ? 'suggestion' : 'suggestions'} ${suggestionVerb}`
        : undefined,
    ]
      .filter(Boolean)
      .map(c => ` · ${c}`)
      .join('')
  const mapChange = entry.memberChanges.find(c => c.mapId === map?.id)

  switch (entry.kind) {
    case MapFamilyHistoryKind.Link: {
      const after = mapChange?.after
      return (
        <>
          placed <MapLink map={map} /> under <MapLink map={otherMap} />
          {after ? HISTORY_RELATION_PHRASES[after.relation] : ''}
          <MutedText>{counts('accepted', accepted)}</MutedText>
        </>
      )
    }
    case MapFamilyHistoryKind.Remove:
      return (
        <>
          took <MapLink map={map} /> out of its family
          <MutedText>{counts('rejected', rejected)}</MutedText>
        </>
      )
    case MapFamilyHistoryKind.UpdateMember: {
      const before = mapChange?.before
      const after = mapChange?.after
      const parts: string[] = []
      if ((before?.versionLabel ?? '') !== (after?.versionLabel ?? '')) {
        parts.push(
          after?.versionLabel
            ? `set the version to “${after.versionLabel}”${
                before?.versionLabel ? ` (was “${before.versionLabel}”)` : ''
              }`
            : 'cleared the version',
        )
      }
      if (before?.pinnedCurrent !== after?.pinnedCurrent) {
        parts.push(after?.pinnedCurrent ? 'pinned as current' : 'unpinned as current')
      }
      return (
        <>
          <MapLink map={map} />: {parts.length ? parts.join(' and ') : 'updated the member'}
        </>
      )
    }
    case MapFamilyHistoryKind.SetLabel:
      return entry.labelAfter ? (
        <>
          set a family's label to “{entry.labelAfter}”
          {entry.labelBefore ? <MutedText> (was “{entry.labelBefore}”)</MutedText> : null}
        </>
      ) : (
        <>cleared a family's label</>
      )
    case MapFamilyHistoryKind.DecideSuggestion: {
      const change =
        entry.suggestionChanges.find(
          c =>
            (c.mapA === map?.id && c.mapB === otherMap?.id) ||
            (c.mapB === map?.id && c.mapA === otherMap?.id),
        ) ?? entry.suggestionChanges[0]
      let afterLabel = change ? SUGGESTION_STATUS_LABELS[change.after] : ''
      if (change?.after === MapLinkSuggestionStatus.Open) {
        afterLabel = 'Reopened'
      }
      return (
        <>
          <MapLink map={map} /> – <MapLink map={otherMap} />:{' '}
          {change ? `${SUGGESTION_STATUS_LABELS[change.before]} → ${afterLabel}` : 'decided'}
        </>
      )
    }
    case MapFamilyHistoryKind.ReportStatus: {
      let verb = 'reopened'
      if (entry.reportStatusAfter === MapFamilyReportStatus.Resolved) {
        verb = 'resolved'
      } else if (entry.reportStatusAfter === MapFamilyReportStatus.Dismissed) {
        verb = 'dismissed'
      }
      return (
        <>
          {verb} a report about <MapLink map={map} />
        </>
      )
    }
    case MapFamilyHistoryKind.Undo:
      return (
        <>
          undid a save
          {map ? (
            <>
              {' '}
              about <MapLink map={map} />
            </>
          ) : null}
          <MutedText>{counts('changed', entry.memberChanges.length)}</MutedText>
        </>
      )
    default:
      return <MutedText>Unknown change</MutedText>
  }
}
