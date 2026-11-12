import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { Link, useRoute } from 'wouter'
import { useLocationProperty } from 'wouter/use-browser-location'
import {
  MAP_COLLECTIONS_SEGMENT,
  MAP_REPORT_PARAM,
  MapCatalogTab,
  mapCollectionIdFromSegment,
  urlForMapCollection,
  urlForMapCollections,
} from '../../common/map-url'
import { filterColorCodes, makeMapCollectionId, MapCollectionId, SbMapId } from '../../common/maps'
import { hasVetoes, MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { useTrackPageView } from '../analytics/analytics'
import { useSelfUser } from '../auth/auth-utils'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapCollectionKind, MapCollectionPageQuery } from '../gql/graphql'
import { dateTimeFormat, numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { LoadErrorRow } from '../lists/load-error-row'
import { RoomChip } from '../lobbies/room/room-parts'
import { IconButton, OutlinedButton, TextButton } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { push, replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  displaySmall,
  labelMedium,
  labelSmall,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import {
  openMapCollectionDeleteDialog,
  openMapCollectionEditDialog,
  openMapCollectionHideDialog,
  openMapCollectionReportDialog,
} from './action-creators'
import {
  CatalogSearchInput,
  MapCatalogFrame,
  useCatalogDensity,
  useCatalogUrlParams,
  useCatalogWindowStore,
} from './map-catalog'
import { EmptyText, MapCatalogList } from './map-catalog-list'
import { MapListing, toMapFilter } from './map-catalog-params'
import {
  useAddMapToCollection,
  useCopyCollectionLink,
  useSetCollectionPublic,
  useToggleCollectionSaved,
  useUnhideCollection,
} from './map-collection-actions'
import { MapCollectionMosaic } from './map-collection-card'
import { MapCollectionReportBar, useCollectionReportOpen } from './map-collection-report-bar'
import {
  collectionTitle,
  mapCountText,
  MAX_COLLECTION_MAPS,
  poolDatesText,
} from './map-collection-text'
import { urlForMapFile } from './map-family-files'
import { useToggleMapFavorite } from './map-favorites'
import { MapFileImage } from './map-image'
import {
  MapPicker,
  MapPickerCollectionTarget,
  MapPickerMode,
  useMapPickerSession,
} from './map-picker'
import { MapTile_SbMapFragment, mapTileMeta } from './map-tile'
import { useUploadMapFiles } from './map-uploads'

const CollectionPageQuery = graphql(/* GraphQL */ `
  query MapCollectionPage($id: UUID!) {
    mapCollection(id: $id) {
      id
      kind
      title
      description
      public
      grantsStaffPick
      canEdit
      isSaved
      mapCount
      owner {
        id
        name
      }
      hidden {
        id
        note
        hiddenAt
      }
      pool {
        id
        matchmakingType
        startDate
        endDate
        isCurrent
        maxVetoCount
        previous {
          id
        }
        next {
          id
        }
      }
      ...MapCollectionMosaic_CollectionFragment
    }
  }
`)

const MapCollectionRow_SbMapFragment = graphql(/* GraphQL */ `
  fragment MapCollectionRow_SbMapFragment on SbMap {
    id
    family {
      id
      listed
    }
    ...MapTile_SbMapFragment
  }
`)

const MapCollectionPageMapsQuery = graphql(/* GraphQL */ `
  query MapCollectionPageMaps($id: UUID!, $after: String, $first: Int!, $withCount: Boolean!) {
    mapCollection(id: $id) {
      id
      maps(after: $after, first: $first) {
        totalCount @include(if: $withCount)
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            ...MapCollectionRow_SbMapFragment
          }
        }
      }
    }
  }
`)

/**
 * Every entry of a collection, as little as is needed to tell which maps it holds and which of them
 * aren't published. A collection holds at most 200 maps, so this is at most two pages.
 */
const MapCollectionEntriesQuery = graphql(/* GraphQL */ `
  query MapCollectionEntries($id: UUID!, $after: String, $first: Int!) {
    mapCollection(id: $id) {
      id
      maps(after: $after, first: $first) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            family {
              id
              listed
            }
          }
        }
      }
    }
  }
`)

/** How many maps each page of a collection's rows loads. */
const ROWS_PAGE_SIZE = 40
/** How many entries each page of {@link MapCollectionEntriesQuery} loads, the most the server allows. */
const ENTRIES_PAGE_SIZE = 100

/**
 * Requests results without suspending: the page renders its own loading states. Module-level so the
 * query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const poolDateFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })
const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })

const NotFoundText = styled.div`
  ${bodyLarge};
  padding: 32px 16px;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

/** The route for a collection's page: `/maps/collections/:id/:slug?`. */
export function MapCollectionPageRoute() {
  const { t } = useTranslation()
  const [match, params] = useRoute(`/maps/${MAP_COLLECTIONS_SEGMENT}/:id/:slug?`)
  useTrackPageView(`/maps/${MAP_COLLECTIONS_SEGMENT}/:id`)

  if (!match) {
    return null
  }
  const id = mapCollectionIdFromSegment(params.id)
  if (!id) {
    return (
      <MapCatalogFrame tab={MapCatalogTab.Collections}>
        <NotFoundText>
          {t('maps.collections.notFound', 'This collection could not be found.')}
        </NotFoundText>
      </MapCatalogFrame>
    )
  }
  return <MapCollectionPage key={id} id={id} />
}

type PageCollection = NonNullable<MapCollectionPageQuery['mapCollection']>

/**
 * A collection's page: what it is, the actions for it, and its maps. Starred lists its maps the way
 * the catalog does, with the catalog's filters, sorts and search; every other collection lists its
 * maps in its own order.
 */
function MapCollectionPage({ id }: { id: MapCollectionId }) {
  const { t } = useTranslation()
  const canManageMaps = useHasAnyPermission('manageMaps')
  const pathname = useLocationProperty(() => location.pathname)
  const search = useLocationProperty(() => location.search)
  const reportId = canManageMaps
    ? (new URLSearchParams(search).get(MAP_REPORT_PARAM) ?? undefined)
    : undefined
  const [adding, setAdding] = useState(false)
  const reportOpen = useCollectionReportOpen(reportId, id)

  const [{ data, error }, reexecute] = useQuery({
    query: CollectionPageQuery,
    variables: { id },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  const collection = data?.mapCollection ?? undefined

  // The server's page metadata builds the same canonical URL, or a page could keep redirecting
  const canonicalPath = collection
    ? urlForMapCollection(id, collection.title ?? undefined)
    : undefined
  const correctedPath = canonicalPath && canonicalPath !== pathname ? canonicalPath : undefined
  useEffect(() => {
    if (correctedPath) {
      // Read when correcting, since the Starred listing may have just added its saved filters
      replace(correctedPath + location.search, history.state)
    }
  }, [correctedPath])

  if (collection && adding) {
    return <AddMapsPicker collection={collection} onClose={() => setAdding(false)} />
  }

  if (collection?.kind === MapCollectionKind.Starred) {
    return <StarredCollectionPage collection={collection} />
  }

  let content: React.ReactNode
  if (!data) {
    content = error ? (
      <NotFoundText>
        <LoadErrorRow
          message={t('maps.collections.loadCollectionError', "Couldn't load this collection")}
          onRetry={() => reexecute({ requestPolicy: 'network-only' })}
        />
      </NotFoundText>
    ) : (
      <LoadingDotsArea />
    )
  } else if (!collection) {
    content = (
      <NotFoundText>
        {t('maps.collections.notFound', 'This collection could not be found.')}
      </NotFoundText>
    )
  } else {
    content = (
      <PageContent>
        <BackLink />
        {reportId ? (
          <MapCollectionReportBar
            reportId={reportId}
            collectionId={collection.id}
            collectionTitle={collectionTitle(collection, t)}
          />
        ) : null}
        <CollectionHeader
          collection={collection}
          reportOpen={!!reportId && reportOpen}
          onAddMaps={() => setAdding(true)}
        />
        <CollectionRows
          collectionId={collection.id}
          ownPoolType={collection.pool?.isCurrent ? collection.pool.matchmakingType : undefined}
        />
      </PageContent>
    )
  }

  return <MapCatalogFrame tab={MapCatalogTab.Collections}>{content}</MapCatalogFrame>
}

const PageContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
`

/** Goes to the Collections tab. */
function BackLink() {
  const { t } = useTranslation()
  return (
    <TextButton
      label={t('maps.collections.tab', 'Collections')}
      iconStart='arrow_back'
      onClick={() => push(urlForMapCollections())}
    />
  )
}

const HeaderRow = styled.div`
  width: 100%;

  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px 24px;
`

const HeaderMosaic = styled(MapCollectionMosaic)`
  width: 168px;
  flex-shrink: 0;
`

const HeaderText = styled.div`
  flex: 1 1 320px;
  min-width: 0;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
`

const Title = styled.h1`
  ${displaySmall};
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--theme-on-surface);
`

const Byline = styled.div`
  ${bodySmall};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;

  color: var(--theme-on-surface-variant);
`

const Description = styled.div`
  ${bodyMedium};
  max-width: 640px;

  color: var(--theme-on-surface);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
`

const MetaLine = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Notice = styled.div`
  ${bodyMedium};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;

  color: var(--theme-on-surface-variant);
`

/** Lines up with the text of the notice above it, past its icon. */
const NoticeDetail = styled.div`
  ${bodyMedium};
  padding-left: 28px;

  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  user-select: text;
`

const ActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

/** The collection's mosaic, what kind of collection it is, its title and description, and its actions. */
function CollectionHeader({
  collection,
  reportOpen = false,
  onAddMaps,
}: {
  collection: PageCollection
  /** Whether a report bar on the page offers to settle an open report about the collection. */
  reportOpen?: boolean
  onAddMaps?: () => void
}) {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const canManageMaps = useHasAnyPermission('manageMaps')
  const isOwner = !!selfUser && collection.owner?.id === selfUser.id
  const title = collectionTitle(collection, t)
  const unlistedCount = useUnlistedCount(collection.id, isOwner && collection.public)

  let kindChip: string | undefined
  if (collection.kind === MapCollectionKind.Staff) {
    kindChip = t('maps.collections.curatedByStaff', 'Curated by SB staff')
  } else if (collection.kind === MapCollectionKind.LadderPool) {
    kindChip = t('maps.collections.ladderPool', 'Ladder pool')
  } else if (isOwner) {
    kindChip = t('maps.collections.yoursChip', 'Yours')
  }

  const count = mapCountText(collection.mapCount, t)
  const poolDates = usePoolDatesText(collection.pool ?? undefined)
  let meta = count
  if (poolDates) {
    meta = [count, poolDates].join(' · ')
  } else if (collection.kind === MapCollectionKind.User && isOwner) {
    meta = [
      collection.public
        ? t('maps.collections.public', 'Public')
        : t('maps.collections.private', 'Private'),
      count,
    ].join(' · ')
  }

  return (
    <HeaderRow>
      <HeaderMosaic collection={collection} size={168} />
      <HeaderText>
        {kindChip ? <RoomChip>{kindChip}</RoomChip> : null}
        <Title>{title}</Title>
        {collection.kind === MapCollectionKind.User && !isOwner && collection.owner ? (
          <Byline>
            <span>{t('maps.page.by', 'by')}</span>
            <ConnectedUsername userId={collection.owner.id} />
          </Byline>
        ) : null}
        {collection.description ? <Description>{collection.description}</Description> : null}
        <MetaLine>{meta}</MetaLine>
        {collection.pool ? <PoolDetails pool={collection.pool} /> : null}
        {collection.hidden && (isOwner || canManageMaps) ? (
          <>
            <Notice>
              <MaterialIcon icon='visibility_off' size={20} />
              {t('maps.collections.hiddenByStaff', 'Hidden by staff')}
            </Notice>
            <NoticeDetail>{`“${collection.hidden.note}”`}</NoticeDetail>
          </>
        ) : null}
        {unlistedCount > 0 ? (
          <Notice>
            <MaterialIcon icon='lock' size={20} />
            {t('maps.collections.unlistedNotice', {
              defaultValue: "Only you can see {{count}} maps here that aren't published",
              defaultValue_one: "Only you can see {{count}} map here that isn't published",
              count: unlistedCount,
            })}
          </Notice>
        ) : null}
        <CollectionActions
          collection={collection}
          isOwner={isOwner}
          reportOpen={reportOpen}
          onAddMaps={onAddMaps}
        />
      </HeaderText>
    </HeaderRow>
  )
}

/**
 * When a ladder pool is played, with years: `Since Jun 30, 2026`, a range for a past pool, or when
 * a scheduled pool starts. Undefined for a collection that isn't a pool.
 */
function usePoolDatesText(
  pool: { startDate: string; endDate?: string | null } | undefined,
): string | undefined {
  const { t } = useTranslation()
  const poolDate = useFormat(poolDateFormat)
  // When the page first rendered is recent enough to tell a scheduled pool by
  const [now] = useState(() => Date.now())
  if (!pool) {
    return undefined
  }
  const formatDate = (date: Date) => poolDate.format(date)
  return Date.parse(pool.startDate) > now
    ? t('maps.collections.poolStarts', {
        defaultValue: 'Starts {{date}}',
        date: formatDate(new Date(pool.startDate)),
      })
    : poolDatesText(pool, formatDate, t)
}

/** The pools before and after a ladder pool, and where its vetoes are set. */
function PoolDetails({ pool }: { pool: NonNullable<PageCollection['pool']> }) {
  const { t } = useTranslation()

  return (
    <>
      {pool.previous || pool.next ? (
        <Notice>
          {pool.previous ? (
            <Link href={urlForMapCollection(makeMapCollectionId(pool.previous.id))}>
              {t('maps.collections.previousPool', 'Previous pool')}
            </Link>
          ) : null}
          {pool.previous && pool.next ? <span>·</span> : null}
          {pool.next ? (
            <Link href={urlForMapCollection(makeMapCollectionId(pool.next.id))}>
              {t('maps.collections.nextPool', 'Next pool')}
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {hasVetoes(pool.matchmakingType) && pool.maxVetoCount > 0 ? (
        <MetaLine>
          {t('maps.collections.poolVetoes', {
            defaultValue:
              'Players can veto up to {{count}} of these maps in their matchmaking preferences.',
            defaultValue_one:
              'Players can veto {{count}} of these maps in their matchmaking preferences.',
            count: pool.maxVetoCount,
          })}
        </MetaLine>
      ) : null}
    </>
  )
}

/** An item of the page's menu: its text and what it does. */
type MenuEntry = [text: string, handler: () => void]

function CollectionActions({
  collection,
  isOwner,
  reportOpen,
  onAddMaps,
}: {
  collection: PageCollection
  isOwner: boolean
  /** Whether a report bar on the page offers to settle an open report, which owns moderation. */
  reportOpen: boolean
  onAddMaps?: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const canManageMaps = useHasAnyPermission('manageMaps')
  const copyLink = useCopyCollectionLink()
  const [toggleSaved, savePending] = useToggleCollectionSaved()
  const [setPublic, publicPending] = useSetCollectionPublic()
  const unhide = useUnhideCollection()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  const id = makeMapCollectionId(collection.id)
  const title = collectionTitle(collection, t)
  const isUserKind = collection.kind === MapCollectionKind.User
  const canSave = collection.public && collection.kind !== MapCollectionKind.Starred && !isOwner
  const canReport = isUserKind && collection.public && !isOwner && !!selfUser && !canManageMaps

  // The menu's items in groups, shown in this order with dividers between them: the collection's
  // own details, then moderation
  const editItems: MenuEntry[] = []
  const moderationItems: MenuEntry[] = []
  const editsDetails =
    (isUserKind && isOwner) || (collection.kind === MapCollectionKind.Staff && collection.canEdit)
  if (editsDetails) {
    editItems.push([
      t('maps.collections.editDetails', 'Edit details'),
      () =>
        dispatch(
          openMapCollectionEditDialog({
            collectionId: collection.id,
            title: collection.title ?? '',
            description: collection.description,
          }),
        ),
    ])
    // A hidden collection stays private until staff unhide it
    if (isUserKind && !collection.hidden) {
      editItems.push(
        collection.public
          ? [
              t('maps.collections.makePrivate', 'Make private'),
              () => setPublic(collection.id, false),
            ]
          : [t('maps.collections.makePublic', 'Make public'), () => setPublic(collection.id, true)],
      )
    }
    if (!collection.grantsStaffPick) {
      editItems.push([
        t('common.actions.delete', 'Delete'),
        () =>
          dispatch(
            openMapCollectionDeleteDialog({
              collectionId: collection.id,
              title,
              mapCount: collection.mapCount,
            }),
          ),
      ])
    }
  }
  // Admin-only, so not translated
  if (canManageMaps && isUserKind && !isOwner && !reportOpen) {
    if (collection.hidden) {
      moderationItems.push(['Unhide', () => unhide(collection.id)])
    } else if (collection.public) {
      moderationItems.push([
        'Hide',
        () => dispatch(openMapCollectionHideDialog({ collectionId: collection.id, title })),
      ])
    }
  }
  const menuGroups = [editItems, moderationItems].filter(group => group.length)
  const menuItemCount = menuGroups.reduce((sum, group) => sum + group.length, 0)
  // A menu would hold only one item, so it's shown as a button instead
  const onlyItem = menuItemCount === 1 ? menuGroups[0][0] : undefined

  const savedLabel = collection.isSaved
    ? t('maps.collections.saved', 'Saved')
    : t('maps.collections.save', 'Save')
  const copyLabel = t('maps.page.copyLink', 'Copy link')
  const reportLabel = t('maps.report.iconLabel', 'Report a problem')
  const menuLabel = t('maps.collections.collectionActions', 'Collection actions')

  return (
    <ActionRow>
      {collection.canEdit && collection.kind !== MapCollectionKind.Starred && onAddMaps ? (
        <OutlinedButton
          label={t('maps.collections.addMaps', 'Add maps')}
          iconStart='add'
          onClick={onAddMaps}
        />
      ) : null}
      {canSave ? (
        <OutlinedButton
          label={savedLabel}
          iconStart={<MaterialIcon icon='bookmark' size={20} filled={collection.isSaved} />}
          disabled={savePending}
          onClick={() => toggleSaved(collection)}
        />
      ) : null}
      {collection.public ? (
        <Tooltip text={copyLabel} position='bottom' tabIndex={-1}>
          <IconButton
            icon={<MaterialIcon icon='link' />}
            ariaLabel={copyLabel}
            onClick={() => copyLink(id, collection.title ?? undefined)}
          />
        </Tooltip>
      ) : null}
      {onlyItem ? (
        <OutlinedButton label={onlyItem[0]} disabled={publicPending} onClick={onlyItem[1]} />
      ) : null}
      {menuItemCount > 1 ? (
        <>
          <Tooltip text={menuLabel} position='bottom' tabIndex={-1}>
            <IconButton
              ref={anchorRef}
              icon={<MaterialIcon icon='more_vert' />}
              ariaLabel={menuLabel}
              ariaHasPopup='menu'
              ariaExpanded={menuOpen}
              onClick={openMenu}
            />
          </Tooltip>
          <Popover
            open={menuOpen}
            onDismiss={closeMenu}
            anchorX={anchorX ?? 0}
            anchorY={anchorY ?? 0}
            originX='right'
            originY='top'>
            <MenuList dense={true}>
              {menuGroups.flatMap((group, i) => [
                ...(i > 0 ? [<Divider key={`divider-${i}`} $dense={true} />] : []),
                ...group.map(([text, handler]) => (
                  <MenuItem
                    key={text}
                    text={text}
                    dense={true}
                    disabled={publicPending}
                    onClick={() => {
                      closeMenu()
                      handler()
                    }}
                  />
                )),
              ])}
            </MenuList>
          </Popover>
        </>
      ) : null}
      {canReport ? (
        <Tooltip text={reportLabel} position='bottom' tabIndex={-1}>
          <IconButton
            icon={<MaterialIcon icon='flag' />}
            ariaLabel={reportLabel}
            onClick={() => dispatch(openMapCollectionReportDialog({ collectionId: collection.id }))}
          />
        </Tooltip>
      ) : null}
    </ActionRow>
  )
}

/**
 * Loads every entry of a collection, as {@link MapCollectionEntriesQuery} selects them, while
 * `enabled`. `entries` is undefined until all of them have loaded.
 */
function useCollectionEntries(collectionId: string, enabled: boolean) {
  const [first] = useQuery({
    query: MapCollectionEntriesQuery,
    variables: { id: collectionId, first: ENTRIES_PAGE_SIZE },
    requestPolicy: 'cache-and-network',
    pause: !enabled,
    context: NO_SUSPENSE_CONTEXT,
  })
  const firstMaps = first.data?.mapCollection?.maps
  const nextCursor = firstMaps?.pageInfo.hasNextPage
    ? (firstMaps.pageInfo.endCursor ?? undefined)
    : undefined
  const [second] = useQuery({
    query: MapCollectionEntriesQuery,
    variables: { id: collectionId, after: nextCursor, first: ENTRIES_PAGE_SIZE },
    requestPolicy: 'cache-and-network',
    pause: !enabled || !nextCursor,
    context: NO_SUSPENSE_CONTEXT,
  })
  const secondMaps = second.data?.mapCollection?.maps

  if (!firstMaps || (nextCursor && !secondMaps)) {
    return undefined
  }
  return [...firstMaps.edges, ...(secondMaps?.edges ?? [])].map(e => e.node)
}

/**
 * How many maps of the viewer's own public collection aren't published, so others don't see them.
 * Counted from every entry of the collection; 0 while they load or when not `enabled`.
 */
function useUnlistedCount(collectionId: string, enabled: boolean): number {
  const entries = useCollectionEntries(collectionId, enabled)
  return enabled && entries ? entries.filter(e => !e.family.listed).length : 0
}

/**
 * The map picker, adding each picked map to the collection and marking the maps already in it. It
 * stays open until closed.
 */
function AddMapsPicker({
  collection,
  onClose,
}: {
  collection: PageCollection
  onClose: () => void
}) {
  const { t } = useTranslation()
  const addMap = useAddMapToCollection()
  const pickerSession = useMapPickerSession()
  const entries = useCollectionEntries(collection.id, true)
  // Maps added while the picker is open, marked before the collection's entries load again
  const [addedFamilyIds, setAddedFamilyIds] = useState<ReadonlySet<string>>(() => new Set())
  const heldFamilyIds = new Set([...(entries ?? []).map(e => e.family.id), ...addedFamilyIds])

  const add = (mapId: SbMapId, familyId?: string) =>
    addMap(collection.id, mapId).then(added => {
      if (added && familyId) {
        setAddedFamilyIds(prev => new Set([...prev, familyId]))
      }
      return added
    })

  const uploadFiles = useUploadMapFiles({
    onStart: () => pickerSession.showUploads(),
    onUploaded: (map, files) => {
      // With several files there's no telling which one was meant, so they're only shown
      if (files.length === 1) {
        add(map.id).catch(() => {})
      }
    },
  })

  const target: MapPickerCollectionTarget = {
    id: collection.id,
    title: collectionTitle(collection, t),
    mapCount: collection.mapCount,
    full: collection.mapCount >= MAX_COLLECTION_MAPS,
    holds: familyId => heldFamilyIds.has(familyId),
    add,
  }

  return (
    <PickerRoot data-content-fullbleed=''>
      <MapPicker
        mode={MapPickerMode.Collection}
        collection={target}
        onUploadFiles={uploadFiles}
        onClose={onClose}
      />
    </PickerRoot>
  )
}

const PickerRoot = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
`

const RowList = styled.ol`
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;

  display: flex;
  flex-direction: column;
  gap: 6px;
`

/**
 * A collection's maps in its own order, numbered, a page at a time as the list scrolls. Each row
 * links to the map's page; for a ladder pool, to the exact file the pool holds.
 */
function CollectionRows({
  collectionId,
  ownPoolType,
}: {
  collectionId: string
  /**
   * The matchmaking type whose current pool the collection is, if it is one. Every row would carry
   * that pool's chip, so none does.
   */
  ownPoolType?: MatchmakingType
}) {
  const { t } = useTranslation()
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  const firstPage = useRowsPage(collectionId, null)
  const lastPage = useRowsPage(collectionId, pageCursors[pageCursors.length - 1])

  const onLoadMore = () => {
    const endCursor = lastPage.connection?.pageInfo.endCursor
    if (lastPage.connection?.pageInfo.hasNextPage && endCursor) {
      setPageCursors(prev => (prev.includes(endCursor) ? prev : [...prev, endCursor]))
    }
  }

  if (!firstPage.connection) {
    return firstPage.error ? (
      <LoadErrorRow
        message={t('maps.catalog.loadError', "Couldn't load maps")}
        onRetry={firstPage.retry}
      />
    ) : (
      <LoadingDotsArea />
    )
  }
  if (!firstPage.connection.edges.length) {
    return <EmptyText>{t('maps.collections.empty', 'There are no maps here yet.')}</EmptyText>
  }

  return (
    <InfiniteScrollList
      nextLoadingEnabled={true}
      isLoadingNext={lastPage.fetching}
      hasNextData={!!lastPage.connection?.pageInfo.hasNextPage}
      nextError={
        lastPage.error ? (
          <LoadErrorRow
            message={t('maps.catalog.loadMoreError', "Couldn't load more maps")}
            onRetry={lastPage.retry}
          />
        ) : undefined
      }
      refreshToken={collectionId}
      onLoadNextData={onLoadMore}>
      <RowList>
        {pageCursors.map((cursor, i) => (
          <RowsChunk
            key={cursor ?? 'first'}
            collectionId={collectionId}
            after={cursor}
            firstNumber={i * ROWS_PAGE_SIZE + 1}
            ownPoolType={ownPoolType}
          />
        ))}
      </RowList>
    </InfiniteScrollList>
  )
}

/**
 * Loads one page of a collection's rows. Every caller asking for the same page shares one request,
 * so the list can read the last page's cursor from the same results its pages render.
 */
function useRowsPage(collectionId: string, after: string | null) {
  const [{ data, fetching, error }, reexecute] = useQuery({
    query: MapCollectionPageMapsQuery,
    variables: {
      id: collectionId,
      after: after ?? undefined,
      first: ROWS_PAGE_SIZE,
      withCount: after === null,
    },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  return {
    connection: data?.mapCollection?.maps,
    fetching,
    error,
    retry: () => reexecute({ requestPolicy: 'network-only' }),
  }
}

function RowsChunk({
  collectionId,
  after,
  firstNumber,
  ownPoolType,
}: {
  collectionId: string
  after: string | null
  /** The number of the chunk's first row. */
  firstNumber: number
  ownPoolType?: MatchmakingType
}) {
  const { connection } = useRowsPage(collectionId, after)
  return (
    <>
      {connection?.edges.map((edge, i) => (
        <CollectionMapRow
          key={edge.node.id}
          map={edge.node}
          number={firstNumber + i}
          ownPoolType={ownPoolType}
        />
      ))}
    </>
  )
}

/**
 * A row's hover and focus states cover all of it, star included: its link stretches over the whole
 * row (see `RowLink`), and the star sits above that.
 */
const Row = styled.li`
  position: relative;
  min-height: 64px;
  padding: 8px 12px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 6px;
  background-color: var(--theme-container-low);

  &:hover {
    background-color: var(--theme-container);
  }

  &:has(a:focus-visible) {
    outline: 2px solid var(--theme-primary);
  }
`

const RowLink = styled(LinkButton)`
  && {
    position: static;
  }

  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 16px;

  &:focus-visible {
    outline: none;
  }

  /* Makes the whole row the link's target, beneath the star */
  &::after {
    position: absolute;
    inset: 0;
    content: '';
    border-radius: 6px;
  }
`

const RowNumber = styled.div`
  ${labelMedium};
  width: 24px;
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  text-align: end;
  font-variant-numeric: tabular-nums;
`

const RowThumbnail = styled.div`
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 4px;
`

const RowText = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const RowNameLine = styled.div`
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 8px;
`

const RowName = styled.div`
  ${titleSmall};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface);
`

const RowMeta = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--color-grey-blue80);
`

const RowGames = styled.div`
  ${labelSmall};
  flex-shrink: 0;
  color: var(--color-grey-blue70);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const RowChip = styled(RoomChip)`
  flex-shrink: 0;
  padding-block: 2px;
`

/**
 * Keeps the chip it wraps from shrinking in the row's tight name line, and above the link that
 * covers the row, so hovering it shows the tooltip.
 */
const RowChipTooltip = styled(Tooltip)`
  position: relative;
  z-index: 1;
  flex-shrink: 0;
`

const StarButton = styled(IconButton)<{ $favorited: boolean }>`
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  color: ${props => (props.$favorited ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)')};
`

/**
 * One map of a collection on one line: its number, image, name, the ladder pools it's in, facts,
 * games, and its star.
 */
function CollectionMapRow({
  map: mapRef,
  number,
  ownPoolType,
}: {
  map: FragmentType<typeof MapCollectionRow_SbMapFragment>
  number: number
  /** A matchmaking type whose pool chip the row leaves out. */
  ownPoolType?: MatchmakingType
}) {
  const { t } = useTranslation()
  const numbers = useFormat(compactNumber)
  const row = useFragment(MapCollectionRow_SbMapFragment, mapRef)
  const map = useFragment(MapTile_SbMapFragment, row)
  const [toggleFavorite, favoritePending] = useToggleMapFavorite()
  const name = filterColorCodes(map.name)
  const starLabel = map.isFavorited
    ? t('maps.thumbnail.removeFromStarred', 'Remove from Starred')
    : t('maps.thumbnail.addToStarred', 'Add to Starred')

  return (
    <Row>
      <RowLink href={urlForMapFile(map.family, map.id)}>
        <RowNumber>{number}</RowNumber>
        <RowThumbnail>
          <MapFileImage file={map.file} name={name} size={48} forceAspectRatio={1} />
        </RowThumbnail>
        <RowText>
          <RowNameLine>
            <RowName>{name}</RowName>
            {row.family.listed ? null : <RowChip>{t('maps.page.unlisted', 'Unlisted')}</RowChip>}
            {map.ladderPools
              .filter(type => type !== ownPoolType)
              .map(type => {
                const label = matchmakingTypeToLabel(type, t)
                return (
                  <RowChipTooltip
                    key={type}
                    text={t(
                      'maps.thumbnail.mapPoolChipTooltip',
                      'In the current {{mode}} ladder map pool',
                      { mode: label },
                    )}
                    position='top'
                    tabIndex={-1}>
                    <RowChip>{label}</RowChip>
                  </RowChipTooltip>
                )
              })}
          </RowNameLine>
          <RowMeta>{mapTileMeta(map, t)}</RowMeta>
        </RowText>
        <RowGames>
          {map.stats
            ? t('maps.catalog.totalGames', {
                defaultValue: '{{formattedCount}} games',
                defaultValue_one: '{{formattedCount}} game',
                count: map.stats.gamesTotal,
                formattedCount: numbers.format(map.stats.gamesTotal),
              })
            : t('maps.catalog.notPlayed', 'Not played yet')}
        </RowGames>
      </RowLink>
      <Tooltip text={starLabel} position='left' tabIndex={-1}>
        <StarButton
          $favorited={map.isFavorited}
          icon={<MaterialIcon icon='star' filled={map.isFavorited} />}
          ariaLabel={starLabel}
          disabled={favoritePending}
          onClick={() => toggleFavorite(map)}
        />
      </Tooltip>
    </Row>
  )
}

/**
 * The viewer's Starred collection: the maps they starred, newest first, as the catalog lists maps,
 * with its filters, sorts and search.
 */
function StarredCollectionPage({ collection }: { collection: PageCollection }) {
  const { t } = useTranslation()
  const { params, sort, onFiltersChange, onSortChange, onClearFilters, onSearchChange } =
    useCatalogUrlParams(MapListing.Starred)
  const [density, setDensity] = useCatalogDensity()
  const windowStore = useCatalogWindowStore()
  const filter = toMapFilter(params)
  const listKey = JSON.stringify([MapListing.Starred, filter, sort])

  return (
    <MapCatalogFrame
      tab={MapCatalogTab.Collections}
      search={
        <CatalogSearchInput
          value={params.search}
          label={t('maps.catalog.searchMaps', 'Search maps')}
          onChange={onSearchChange}
        />
      }>
      <PageContent>
        <BackLink />
        <CollectionHeader collection={collection} />
      </PageContent>
      <MapCatalogList
        key={listKey}
        listing={MapListing.Starred}
        params={params}
        filter={filter}
        sort={sort}
        density={density}
        windowStore={windowStore}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
        onDensityChange={setDensity}
        onClearFilters={onClearFilters}
      />
    </MapCatalogFrame>
  )
}
