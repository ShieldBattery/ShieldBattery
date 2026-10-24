import { ResultOf } from '@graphql-typed-document-node/core'
import { atom, useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useClient, useMutation, useQuery } from 'urql'
import { Link, Route, Switch } from 'wouter'
import { mapIdFromRouteSegment, urlForMap } from '../../common/map-url'
import { makeSbMapId, SbMapId, Tileset, tilesetToName } from '../../common/maps'
import { FragmentType, graphql, useFragment } from '../gql'
import {
  MapFamilyRelation,
  MapFamilyReportKind,
  MapFamilyReportStatus,
  MapLinkSource,
  MapLinkSuggestionDecision,
  MapProposedRelation,
} from '../gql/graphql'
import { NarrowDuration } from '../i18n/date-formats'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { jotaiStore } from '../jotai-store'
import { RoomChip } from '../lobbies/room/room-parts'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TabItem, Tabs } from '../material/tabs'
import { TextField } from '../material/text-field'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
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
import { openMapCompareDialog } from './action-creators'
import {
  FamilyEditorFile,
  FamilyPlacement,
  FamilyPlacements,
  hasFamilyEdits,
  orderRows,
  parentOptions,
  placeFile,
  planFamilyEdits,
} from './family-editor'
import { MapFileImage } from './map-image'

const BASE_URL = '/admin/map-families'
const PAGE_SIZE = 50
/** How many queued groups "Next" looks through for one that hasn't been skipped. */
const NEXT_LOOKAHEAD = 100

function editorUrl(mapId: SbMapId, withIds: ReadonlyArray<SbMapId> = []): string {
  const base = `${BASE_URL}/maps/${encodeURIComponent(mapId)}`
  return withIds.length ? `${base}?with=${withIds.map(encodeURIComponent).join(',')}` : base
}

/** Map ids of the groups skipped with "Next" this session, so "Next" doesn't come back to them. */
const skippedMapIdsAtom = atom<ReadonlySet<SbMapId>>(new Set<SbMapId>())

const RELATION_LABELS: Record<MapFamilyRelation, string> = {
  [MapFamilyRelation.Root]: 'Top of a tree',
  [MapFamilyRelation.Version]: 'Version',
  [MapFamilyRelation.Variant]: 'Variant',
  [MapFamilyRelation.Translation]: 'Translation',
  [MapFamilyRelation.Fork]: 'Fork',
}

const PROPOSED_RELATION_LABELS: Record<MapProposedRelation, string> = {
  [MapProposedRelation.Version]: 'version',
  [MapProposedRelation.Variant]: 'variant',
  [MapProposedRelation.Translation]: 'translation',
  [MapProposedRelation.Fork]: 'fork',
  [MapProposedRelation.TerrainOnly]: 'terrain only',
  [MapProposedRelation.Unrelated]: 'unrelated',
}

const SOURCE_LABELS: Record<MapLinkSource, string> = {
  [MapLinkSource.Rule]: 'Placed by rule',
  [MapLinkSource.Publisher]: 'Placed by publisher',
  [MapLinkSource.Moderator]: 'Placed by staff',
}

const MapFamilyProposalCountsQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyCounts {
    mapFamilyProposalCount
    mapFamilyReportCount
  }
`)

const MapFamilyProposalsQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyProposals($limit: Int!, $offset: Int!) {
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
        label
      }
      suggestions {
        id
      }
    }
  }
`)

const MapFamilyReportsQuery = graphql(/* GraphQL */ `
  query AdminMapFamilyReports($limit: Int!, $offset: Int!) {
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
      reportedBy {
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
  query AdminMapFamilyGroup($mapIds: [SbMapId!]!) {
    mapFamilyGroup(mapIds: $mapIds) {
      id
      games
      maps {
        id
        name
        firstSeenAt
        ...AdminMapFamilies_FileFragment
      }
      families {
        id
        familyId
        label
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

const FamilyLinkMutation = graphql(/* GraphQL */ `
  mutation AdminMapFamilyLink($links: [MapFamilyLinkInput!]!) {
    mapFamilyLink(links: $links) {
      id
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

const FamilySetLabelMutation = graphql(/* GraphQL */ `
  mutation AdminMapFamilySetLabel($familyId: UUID!, $label: String) {
    mapFamilySetLabel(familyId: $familyId, label: $label) {
      id
      label
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
  return (
    <Switch>
      <Route path={`${BASE_URL}/maps/:mapId`}>
        {params => <FamilyEditorPage mapId={params.mapId} />}
      </Route>
      <Route path={`${BASE_URL}/reports`}>
        <FamilyQueue tab='reports' />
      </Route>
      <Route>
        <FamilyQueue tab='proposals' />
      </Route>
    </Switch>
  )
}

type QueueTab = 'proposals' | 'reports'

function FamilyQueue({ tab }: { tab: QueueTab }) {
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
      <StyledTabs
        activeTab={tab}
        onChange={(value: QueueTab) =>
          push(value === 'reports' ? `${BASE_URL}/reports` : BASE_URL)
        }>
        <TabItem
          value='proposals'
          text={`Proposals${counts ? ` (${counts.mapFamilyProposalCount})` : ''}`}
        />
        <TabItem
          value='reports'
          text={`Reports${counts ? ` (${counts.mapFamilyReportCount})` : ''}`}
        />
      </StyledTabs>
      {tab === 'proposals' ? (
        <ProposalsTable key={refreshToken} />
      ) : (
        <ReportsTable
          key={refreshToken}
          onChanged={() => refetchCounts({ requestPolicy: 'network-only' })}
        />
      )}
    </Content>
  )
}

function ProposalsTable() {
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
  isLastPage,
  onLoadMore,
}: {
  offset: number
  isLastPage: boolean
  onLoadMore: () => void
}) {
  const [{ data, fetching, error }] = useQuery({
    query: MapFamilyProposalsQuery,
    variables: { limit: PAGE_SIZE, offset },
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

function ReportsTable({ onChanged }: { onChanged: () => void }) {
  const [pages, setPages] = useState(1)
  return (
    <Table>
      <TableHeader>
        <Cell $width={112}>Date</Cell>
        <Cell $width={200}>Map</Cell>
        <Cell $width={240}>Report</Cell>
        <Cell>Note</Cell>
        <Cell $width={140}>Reporter</Cell>
        <Cell $width={56} />
      </TableHeader>
      {Array.from({ length: pages }, (_, i) => (
        <ReportsPage
          key={i}
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
  isLastPage,
  onLoadMore,
  onChanged,
}: {
  offset: number
  isLastPage: boolean
  onLoadMore: () => void
  onChanged: () => void
}) {
  const snackbarController = useSnackbarController()
  const [{ data, fetching, error }, refetch] = useQuery({
    query: MapFamilyReportsQuery,
    variables: { limit: PAGE_SIZE, offset },
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
          <Cell $width={140}>
            {r.reportedBy ? (
              <span onClick={e => e.stopPropagation()}>
                <ConnectedUsername userId={r.reportedBy.id} />
              </span>
            ) : (
              <MutedText>Unknown user</MutedText>
            )}
          </Cell>
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
  ref: FragmentType<typeof AdminMapFamilies_FileFragment>
}

interface MemberInfo {
  familyId: string
  isCurrent: boolean
  pinnedCurrent: boolean
  source: MapLinkSource
  listed: boolean
}

const EditorHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 16px 0;
`

const BackLink = styled(Link)`
  ${bodyMedium};
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
`

const EditorTitle = styled.div`
  ${titleLarge};
`

const FamilyLabels = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 8px 0 16px;

  & > * {
    width: 320px;
  }
`

const SectionTitle = styled.div`
  ${titleMedium};
  margin: 24px 0 8px;
`

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const Row = styled.div<{ $depth: number }>`
  display: flex;
  gap: 16px;
  padding: 12px 16px;
  padding-left: ${props => 16 + props.$depth * 40}px;

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }
`

const Thumb = styled.div`
  flex: 0 0 64px;
  width: 64px;
  height: 64px;
  border-radius: 4px;
  overflow: hidden;
`

const RowBody = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const RowTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const RowName = styled(Link)`
  ${titleMedium};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface);
`

const RowMeta = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
`

const RowControls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
`

const RelationSelect = styled(Select)`
  width: 180px;
`

const ParentSelect = styled(Select)`
  width: 260px;
`

const LabelField = styled(TextField)`
  width: 120px;
`

const RowActions = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 4px;
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

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
`

const ResetButton = styled(TextButton)`
  margin-right: auto;
`

function FamilyEditorPage({ mapId: mapIdParam }: { mapId: string }) {
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
    variables: { mapIds },
    requestPolicy: 'cache-and-network',
  })

  return (
    <Content>
      <EditorHeader>
        <BackLink href={BASE_URL}>
          <MaterialIcon icon='arrow_back' size={20} />
          Map families
        </BackLink>
      </EditorHeader>
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {!data && fetching ? <LoadingDotsArea /> : null}
      {data ? (
        <FamilyEditor
          key={mapIds.join(',')}
          group={data.mapFamilyGroup}
          mapIds={mapIds}
          onAddFile={id => setWithParam([...withIds, id].join(','))}
          refetch={() => refetch({ requestPolicy: 'network-only' })}
        />
      ) : null}
    </Content>
  )
}

type GroupData = ResultOf<typeof MapFamilyGroupQuery>['mapFamilyGroup']

function FamilyEditor({
  group,
  mapIds,
  onAddFile,
  refetch,
}: {
  group: GroupData
  mapIds: ReadonlyArray<SbMapId>
  onAddFile: (id: SbMapId) => void
  refetch: () => void
}) {
  const dispatch = useAppDispatch()
  const client = useClient()
  const snackbarController = useSnackbarController()
  const skippedMapIds = useAtomValue(skippedMapIdsAtom)
  const [edits, setEdits] = useState<ReadonlyMap<SbMapId, FamilyPlacement>>(new Map())
  const [familyLabels, setFamilyLabels] = useState<ReadonlyMap<string, string>>(new Map())
  const [applying, setApplying] = useState(false)

  const [, link] = useMutation(FamilyLinkMutation)
  const [, removeMember] = useMutation(FamilyRemoveMutation)
  const [, updateMember] = useMutation(FamilyUpdateMemberMutation)
  const [, setFamilyLabel] = useMutation(FamilySetLabelMutation)
  const [, decide] = useMutation(SuggestionDecideMutation)

  const fileData = new Map<SbMapId, FileData>()
  const members = new Map<SbMapId, MemberInfo>()
  const files: FamilyEditorFile[] = []
  for (const family of group.families) {
    for (const member of family.members) {
      fileData.set(member.mapId, { name: member.map.name, ref: member.map })
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
    fileData.set(map.id, { name: map.name, ref: map })
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
  const labelEdits = Array.from(familyLabels.entries()).filter(
    ([familyId, label]) =>
      label.trim() !== (group.families.find(f => f.familyId === familyId)?.label ?? ''),
  )
  /** Whether applying would change anything (accepting the proposed tree as it is counts). */
  const dirty = hasFamilyEdits(plan) || labelEdits.length > 0
  /** Whether staff changed anything the queue proposed. */
  const edited = edits.size > 0 || labelEdits.length > 0
  const nameOf = (id: SbMapId) => fileData.get(id)?.name ?? 'Unknown map'

  const setPlacement = (id: SbMapId, placement: FamilyPlacement) => {
    setEdits(placeFile(placements, id, placement))
  }

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

  const runMutation = async <T,>(
    promise: Promise<{ error?: Error | undefined; data?: T }>,
  ): Promise<T | undefined> => {
    const result = await promise
    if (result.error) {
      throw result.error
    }
    return result.data
  }

  const onApply = async () => {
    setApplying(true)
    try {
      if (plan.links.length) {
        await runMutation(link({ links: plan.links }))
      }
      for (const { mapId, versionLabel } of plan.labels) {
        await runMutation(updateMember({ mapId, versionLabel }))
      }
      for (const { mapA, mapB, decision } of plan.decisions) {
        await runMutation(decide({ mapA, mapB, decision }))
      }
      for (const [familyId, label] of labelEdits) {
        await runMutation(setFamilyLabel({ familyId, label: label.trim() || null }))
      }
    } catch (err) {
      showError("Couldn't apply every change", err)
      setApplying(false)
      setEdits(new Map())
      refetch()
      return
    }

    try {
      const result = await client
        .query(MapFamilyGroupQuery, { mapIds: [...mapIds] }, { requestPolicy: 'network-only' })
        .toPromise()
      const stillOpen = result.data?.mapFamilyGroup.suggestions.length ?? 0
      setEdits(new Map())
      setFamilyLabels(new Map())
      if (stillOpen > 0) {
        snackbarController.showSnackbar(
          `Applied. ${stillOpen} ${stillOpen === 1 ? 'pair is' : 'pairs are'} still open.`,
        )
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

  const rows = orderRows(files, placements)
  const title =
    group.families.find(f => f.label)?.label ?? (rows.length ? nameOf(rows[0].id) : 'Map family')

  return (
    <>
      <EditorTitle>{title}</EditorTitle>
      <MutedText>
        {files.length} {files.length === 1 ? 'file' : 'files'} · {group.games} games
      </MutedText>
      {group.families.length ? (
        <FamilyLabels>
          {group.families.map(family => {
            const top = family.members.find(m => !m.parentId)
            return (
              <TextField
                key={family.familyId}
                label={
                  group.families.length > 1 && top
                    ? `Label (family of ${top.map.name})`
                    : 'Family label'
                }
                dense={true}
                allowErrors={false}
                value={familyLabels.get(family.familyId) ?? family.label ?? ''}
                onChange={e =>
                  setFamilyLabels(new Map(familyLabels).set(family.familyId, e.target.value))
                }
              />
            )
          })}
        </FamilyLabels>
      ) : null}

      <SectionTitle>Files</SectionTitle>
      <Rows>
        {rows.map(row => (
          <FamilyFileRow
            key={row.id}
            depth={row.depth}
            file={files.find(f => f.id === row.id)!}
            data={fileData.get(row.id)!.ref}
            member={members.get(row.id)}
            placement={placements.get(row.id)!}
            parentOptions={parentOptions(placements, row.id)}
            nameOf={nameOf}
            actionsDisabled={edited || applying}
            onChange={placement => setPlacement(row.id, placement)}
            onPin={pinned =>
              onImmediate(
                "Couldn't change the current version",
                updateMember({ mapId: row.id, pinnedCurrent: pinned }),
              )
            }
            onRemove={() => onImmediate("Couldn't remove the map", removeMember({ mapId: row.id }))}
            onCompare={parentId => dispatch(openMapCompareDialog(parentId, row.id))}
          />
        ))}
      </Rows>

      {group.suggestions.length ? (
        <>
          <SectionTitle>Open pairs ({group.suggestions.length})</SectionTitle>
          <Rows>
            {group.suggestions.map(s => {
              const older = s.olderMapId ?? s.mapA.id
              const newer = older === s.mapA.id ? s.mapB.id : s.mapA.id
              const facts = [
                s.proposedRelation ? PROPOSED_RELATION_LABELS[s.proposedRelation] : 'no proposal',
                s.rule ? `rule ${s.rule}` : undefined,
                s.terrainSimilarity !== null && s.terrainSimilarity !== undefined
                  ? `${Math.round(s.terrainSimilarity * 100)}% terrain`
                  : undefined,
                s.nameMatch ? 'same name' : undefined,
              ].filter(Boolean)
              return (
                <PairRow key={s.id}>
                  <PairText>
                    {nameOf(older)} → {nameOf(newer)} <MutedText>· {facts.join(' · ')}</MutedText>
                  </PairText>
                  <Tooltip text='Compare' position='bottom' tabIndex={-1}>
                    <IconButton
                      icon={<MaterialIcon icon='compare' />}
                      ariaLabel='Compare'
                      onClick={() => dispatch(openMapCompareDialog(older, newer))}
                    />
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
                        'Terrain only',
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

      <SectionTitle>Add a file</SectionTitle>
      <AddFile present={new Set(files.map(f => f.id))} onAdd={onAddFile} />

      <Footer>
        {edited ? (
          <ResetButton
            label='Reset to proposal'
            disabled={applying}
            onClick={() => {
              setEdits(new Map())
              setFamilyLabels(new Map())
            }}
          />
        ) : null}
        {dirty ? (
          <>
            <TextButton
              label='Skip'
              disabled={applying}
              onClick={() => {
                goToNext(true).catch(err => showError("Couldn't load the next group", err))
              }}
            />
            <FilledButton
              label='Apply and next'
              disabled={applying}
              onClick={() => {
                onApply().catch(err => showError("Couldn't apply every change", err))
              }}
            />
          </>
        ) : (
          <FilledButton
            label='Next'
            onClick={() => {
              goToNext(true).catch(err => showError("Couldn't load the next group", err))
            }}
          />
        )}
      </Footer>
    </>
  )
}

/** Values of the relation select: a family relation, or a way to leave the file out. */
type RelationChoice = MapFamilyRelation | 'rejected' | 'terrainOnly'

const CHOICE_LABELS: Record<RelationChoice, string> = {
  ...RELATION_LABELS,
  rejected: 'Not related',
  terrainOnly: 'Terrain only',
}

function FamilyFileRow({
  depth,
  file,
  data: dataRef,
  member,
  placement,
  parentOptions,
  nameOf,
  actionsDisabled,
  onChange,
  onPin,
  onRemove,
  onCompare,
}: {
  depth: number
  file: FamilyEditorFile
  data: FragmentType<typeof AdminMapFamilies_FileFragment>
  member: MemberInfo | undefined
  placement: FamilyPlacement
  parentOptions: SbMapId[]
  nameOf: (id: SbMapId) => string
  actionsDisabled: boolean
  onChange: (placement: FamilyPlacement) => void
  onPin: (pinned: boolean) => void
  onRemove: () => void
  onCompare: (parentId: SbMapId) => void
}) {
  const { t } = useTranslation()
  const format = useFormat(firstSeenFormat)
  const data = useFragment(AdminMapFamilies_FileFragment, dataRef)

  const isInitialTop = file.initial.kind === 'tree' && !file.initial.parentId
  const relationChoices: RelationChoice[] = [
    ...(!file.inFamily || isInitialTop ? [MapFamilyRelation.Root] : []),
    MapFamilyRelation.Version,
    MapFamilyRelation.Variant,
    MapFamilyRelation.Translation,
    MapFamilyRelation.Fork,
    ...(!file.inFamily ? (['rejected', 'terrainOnly'] as const) : []),
  ]
  let choice: RelationChoice
  if (placement.kind === 'tree') {
    choice = placement.relation
  } else {
    choice =
      placement.decision === MapLinkSuggestionDecision.TerrainOnly ? 'terrainOnly' : 'rejected'
  }
  const versionLabel = placement.kind === 'tree' ? placement.versionLabel : ''

  const onRelation = (value: RelationChoice) => {
    if (value === 'rejected' || value === 'terrainOnly') {
      onChange({
        kind: 'decided',
        decision:
          value === 'rejected'
            ? MapLinkSuggestionDecision.Rejected
            : MapLinkSuggestionDecision.TerrainOnly,
      })
    } else if (value === MapFamilyRelation.Root) {
      onChange({ kind: 'tree', parentId: undefined, relation: value, versionLabel })
    } else {
      const currentParent = placement.kind === 'tree' ? placement.parentId : undefined
      const parentId = currentParent ?? parentOptions[0]
      if (!parentId) {
        return
      }
      onChange({ kind: 'tree', parentId, relation: value, versionLabel })
    }
  }

  const games = data.stats?.gamesTotal ?? 0
  const makers = data.file.analysis?.makers ?? []
  const credited = data.file.analysis?.credited ?? []
  const meta = [
    `${games} ${games === 1 ? 'game' : 'games'}`,
    `first seen ${format.format(new Date(data.firstSeenAt))}`,
    `${data.file.width}×${data.file.height} ${tilesetToName(data.file.tileset as Tileset, t)}`,
    makers.length ? `makers: ${makers.join(', ')}` : undefined,
    credited.length ? `credits: ${credited.join(', ')}` : undefined,
  ].filter(Boolean)

  const menuItems: Array<[string, () => void]> = []
  if (member) {
    if (member.listed && !member.pinnedCurrent) {
      menuItems.push(['Pin as current', () => onPin(true)])
    } else if (member.pinnedCurrent) {
      menuItems.push(['Unpin as current', () => onPin(false)])
    }
    menuItems.push(['Remove from family', onRemove])
  }

  return (
    <Row $depth={depth}>
      <Thumb>
        <MapFileImage file={data.file} name={data.name} size={64} />
      </Thumb>
      <RowBody>
        <RowTitle>
          <RowName href={urlForMap(data.id, data.name)}>{data.name}</RowName>
          {member?.isCurrent ? <RoomChip>Current</RoomChip> : null}
          {!data.listed ? <RoomChip>Unlisted</RoomChip> : null}
          {data.official ? <RoomChip>Official</RoomChip> : null}
        </RowTitle>
        <RowMeta>
          {member ? SOURCE_LABELS[member.source] : 'Not in a family'} · {meta.join(' · ')}
        </RowMeta>
        <RowControls>
          <RelationSelect
            value={choice}
            dense={true}
            allowErrors={false}
            ariaLabel='Relation'
            onChange={onRelation}>
            {relationChoices.map(c => (
              <SelectOption key={c} value={c} text={CHOICE_LABELS[c]} />
            ))}
          </RelationSelect>
          {placement.kind === 'tree' && placement.parentId ? (
            <ParentSelect
              value={placement.parentId}
              dense={true}
              allowErrors={false}
              ariaLabel='Parent'
              onChange={(parentId: SbMapId) => onChange({ ...placement, parentId })}>
              {parentOptions.map(id => (
                <SelectOption key={id} value={id} text={`of ${nameOf(id)}`} />
              ))}
            </ParentSelect>
          ) : null}
          {placement.kind === 'tree' ? (
            <LabelField
              label='Version'
              dense={true}
              allowErrors={false}
              value={placement.versionLabel}
              onChange={e => onChange({ ...placement, versionLabel: e.target.value })}
            />
          ) : null}
        </RowControls>
      </RowBody>
      <RowActions>
        {placement.kind === 'tree' && placement.parentId ? (
          <Tooltip text='Compare with parent' position='bottom' tabIndex={-1}>
            <IconButton
              icon={<MaterialIcon icon='compare' />}
              ariaLabel='Compare with parent'
              onClick={() => onCompare(placement.parentId!)}
            />
          </Tooltip>
        ) : null}
        {menuItems.length ? (
          <OverflowMenu label='File actions' items={menuItems} disabled={actionsDisabled} />
        ) : null}
      </RowActions>
    </Row>
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
