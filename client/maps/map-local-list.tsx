import { TFunction } from 'i18next'
import * as React from 'react'
import { Suspense, use, useDeferredValue, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import {
  LocalMapFile,
  LocalMapIndexProgress,
  LocalMapQuery,
  LocalMapRoot,
  LocalMapSort,
} from '../../common/map-library'
import { urlForMap } from '../../common/map-url'
import { SbMapId } from '../../common/maps'
import { redirectToLogin, useSelfUser } from '../auth/auth-utils'
import { graphql } from '../gql'
import { MaterialIcon } from '../icons/material/material-icon'
import { crumbsForPath, FolderBreadcrumb, FolderRows } from '../lists/folder-navigation'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { IconButton, TextButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { bodyMedium } from '../styles/typography'
import {
  readLocalMapFolders,
  readLocalMaps,
  readLocalMapsStatus,
  useLocalMapsProgress,
  useLocalMapsVersion,
  useLocalMapUploads,
  useUploadLocalMapFile,
} from './local-maps'
import {
  CatalogDensity,
  CatalogFilterRow,
  DENSITY_LAYOUT,
  EmptyState,
  EmptyText,
  Grid,
  MapPickOptions,
} from './map-catalog-list'
import {
  CatalogFilters,
  CatalogParams,
  CatalogSort,
  isNarrowed,
  LOCAL_SORTS,
  toLocalMapQuery,
} from './map-catalog-params'
import { mapFileIdToHash } from './map-file-hash'
import { LocalMapTile, MapTile, MapTileSignal } from './map-tile'

/** How many files each page of the listing reads from the index. */
const PAGE_SIZE = 40

/** How the maps on this PC are laid out. */
export enum LocalMapView {
  /** Every map in one list. */
  List = 'list',
  /** Folder by folder, mirroring the folders on disk. */
  Folders = 'folders',
}

export function validateLocalMapView(value: unknown): LocalMapView | undefined {
  return Object.values(LocalMapView).includes(value as LocalMapView)
    ? (value as LocalMapView)
    : undefined
}

const LocalKnownMapsQuery = graphql(/* GraphQL */ `
  query LocalKnownMaps($hashes: [String!]!) {
    mapsByHash(hashes: $hashes) {
      id
      file {
        id
      }
      ...MapTile_SbMapFragment
    }
  }
`)

const LocalAddToLibraryMutation = graphql(/* GraphQL */ `
  mutation LocalAddToLibrary($id: SbMapId!) {
    mapAddToLibrary(id: $id) {
      id
      inLibrary
    }
  }
`)

/** Requests results without suspending: tiles fill in once the server answers. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const StatusLine = styled.div`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--theme-on-surface-variant);
`

function rootLabel(root: string, t: TFunction): string | undefined {
  switch (root) {
    case LocalMapRoot.Install:
      return t('maps.local.installFolder', 'StarCraft install')
    case LocalMapRoot.Documents:
      return t('maps.local.documentsFolder', 'Documents')
    default:
      return undefined
  }
}

/** A folder's name for display: friendly names for the roots, the folder's own name otherwise. */
function folderLabel(path: string, name: string, t: TFunction): string {
  return (!path.includes('/') && rootLabel(path, t)) || name
}

/** Where a file is, for listings that span folders: `Documents › Download › UMS`. */
function fileFolderLabel(folder: string, t: TFunction): string {
  const segments = folder.split('/')
  return segments.map((name, i) => (i === 0 ? (rootLabel(name, t) ?? name) : name)).join(' › ')
}

function mapCountLabel(count: number, t: TFunction): string {
  return t('maps.catalog.mapCount', {
    defaultValue: '{{count}} maps',
    defaultValue_one: '{{count}} map',
    count,
  })
}

function IndexingLine({ progress }: { progress: LocalMapIndexProgress | undefined }) {
  const { t } = useTranslation()
  if (!progress) {
    return null
  }
  return (
    <StatusLine>
      <MaterialIcon icon='sync' size={20} />
      {progress.phase === 'scanning'
        ? t('maps.local.scanning', 'Looking for maps on this PC…')
        : t('maps.local.indexing', {
            defaultValue: 'Reading maps on this PC… {{done}} of {{total}}',
            done: progress.done,
            total: progress.total,
          })}
    </StatusLine>
  )
}

export interface LocalMapListProps {
  params: CatalogParams
  sort: CatalogSort
  density: CatalogDensity
  view: LocalMapView
  /** The folder shown in the folders view; unset shows the map folders themselves. */
  folder: string | undefined
  /** When set, choosing a map picks it (uploading it first if the server doesn't have it). */
  pick?: MapPickOptions
  onFiltersChange: (changes: Partial<CatalogFilters>) => void
  onSortChange: (sort: CatalogSort) => void
  onDensityChange: (density: CatalogDensity) => void
  onClearFilters: () => void
  onViewChange: (view: LocalMapView) => void
  onFolderChange: (folder: string | undefined) => void
}

/**
 * The map files in the user's StarCraft map folders, as the app's index has them: filtered,
 * searched and sorted locally, either as one list or folder by folder. Files the server already has
 * show as the server's map; the rest are read from the file and uploaded when chosen.
 */
export function LocalMapList(props: LocalMapListProps) {
  return (
    <Suspense
      fallback={
        <>
          <LocalFilterRow {...props} totalCount={undefined} />
          <LoadingDotsArea />
        </>
      }>
      <LocalMapListContent {...props} />
    </Suspense>
  )
}

function LocalFilterRow({
  params,
  sort,
  density,
  view,
  totalCount,
  onFiltersChange,
  onSortChange,
  onDensityChange,
  onClearFilters,
  onViewChange,
}: LocalMapListProps & { totalCount: number | undefined }) {
  const { t } = useTranslation()
  const viewLabel =
    view === LocalMapView.Folders
      ? t('maps.local.showList', 'Show as one list')
      : t('maps.local.showFolders', 'Show folders')
  return (
    <CatalogFilterRow
      params={params}
      sort={sort}
      density={density}
      totalCount={totalCount}
      sorts={LOCAL_SORTS}
      offersBestMatch={false}
      showOfficial={false}
      viewToggle={
        <Tooltip text={viewLabel} position='bottom' tabIndex={-1}>
          <IconButton
            icon={<MaterialIcon icon={view === LocalMapView.Folders ? 'view_list' : 'folder'} />}
            ariaLabel={viewLabel}
            onClick={() =>
              onViewChange(view === LocalMapView.Folders ? LocalMapView.List : LocalMapView.Folders)
            }
          />
        </Tooltip>
      }
      onFiltersChange={onFiltersChange}
      onSortChange={onSortChange}
      onDensityChange={onDensityChange}
      onClearFilters={onClearFilters}
    />
  )
}

function LocalMapListContent(props: LocalMapListProps) {
  const { t } = useTranslation()
  const { params, sort, view, folder, onFolderChange, onClearFilters } = props
  const progress = useLocalMapsProgress()
  const narrowed = isNarrowed(params)
  const inFolders = view === LocalMapView.Folders
  // Searching or filtering looks through everything beneath the current folder (or every folder,
  // at the top level) and lists the matches instead of the folders
  const showFiles = !inFolders || folder !== undefined || narrowed
  const folderFilter =
    inFolders && folder !== undefined ? { path: folder, recursive: narrowed } : undefined
  const query = toLocalMapQuery(params, sort, folderFilter)

  // Reads follow these deferred values, so changing the filters (or the index changing) keeps the
  // current results on screen until the new ones are ready instead of blanking the list
  const version = useDeferredValue(useLocalMapsVersion())
  const queryKey = useDeferredValue(JSON.stringify(query))
  const deferredQuery = JSON.parse(queryKey) as Omit<LocalMapQuery, 'offset' | 'limit'>
  const deferredFolder = useDeferredValue(folder)

  const firstPage = use(readLocalMaps({ ...deferredQuery, offset: 0, limit: PAGE_SIZE }, version))
  const showFolderRows = inFolders && !narrowed
  const folders = showFolderRows ? use(readLocalMapFolders(deferredFolder, version)) : undefined
  const status = use(readLocalMapsStatus(version))

  const total = firstPage.ok ? firstPage.value.total : undefined
  const crumbs = crumbsForPath(folder, t('maps.local.mapFolders', 'Map folders'), (path, name) =>
    folderLabel(path, name, t),
  )

  let files: React.ReactNode = null
  if (showFiles) {
    if (!firstPage.ok) {
      files = (
        <EmptyState>
          <EmptyText>{t('maps.local.loadError', "Couldn't read the maps on this PC.")}</EmptyText>
        </EmptyState>
      )
    } else if (firstPage.value.total === 0) {
      let text: string
      if (narrowed) {
        text = t('maps.catalog.noMatches', 'No maps match these filters.')
      } else if (status.ok && status.value.totalIndexed === 0 && !progress) {
        text = t('maps.local.noMapFiles', 'No map files were found in your StarCraft map folders.')
      } else if (inFolders) {
        text = t('maps.local.emptyFolder', 'There are no maps directly in this folder.')
      } else {
        text = t('maps.catalog.noMaps', 'There are no maps here yet.')
      }
      // A folder holding only subfolders is no reason for an empty state
      const hasSubfolders = folders?.ok && folders.value.length > 0
      files =
        hasSubfolders && !narrowed ? null : (
          <EmptyState>
            <EmptyText>{text}</EmptyText>
            {narrowed ? (
              <TextButton
                label={t('maps.catalog.clearFilters', 'Clear filters')}
                onClick={onClearFilters}
              />
            ) : null}
          </EmptyState>
        )
    } else {
      files = (
        <LocalMapGrid
          key={`${version}|${queryKey}`}
          query={deferredQuery}
          version={version}
          firstPageTotal={firstPage.value.total}
          spansFolders={!inFolders || narrowed}
          {...props}
        />
      )
    }
  }

  return (
    <>
      <LocalFilterRow {...props} totalCount={showFiles ? total : undefined} />
      <IndexingLine progress={progress} />
      {status.ok && !status.value.roots.some(r => r.root === LocalMapRoot.Install) ? (
        <StatusLine>
          <MaterialIcon icon='info' size={20} />
          {t(
            'maps.local.noInstallFolder',
            'Set your StarCraft folder in Settings to include the maps in its Maps folder.',
          )}
        </StatusLine>
      ) : null}
      {inFolders ? <FolderBreadcrumb crumbs={crumbs} onNavigate={onFolderChange} /> : null}
      {folders?.ok && folders.value.length > 0 ? (
        <FolderRows
          folders={folders.value.map(f => ({
            path: f.path,
            name: folderLabel(f.path, f.name, t),
            count: f.fileCount,
          }))}
          countLabel={count => mapCountLabel(count, t)}
          onOpen={onFolderChange}
        />
      ) : null}
      {files}
    </>
  )
}

function LocalMapGrid({
  query,
  version,
  firstPageTotal,
  spansFolders,
  density,
  pick,
}: LocalMapListProps & {
  query: Omit<LocalMapQuery, 'offset' | 'limit'>
  version: number
  firstPageTotal: number
  /** Whether the listing spans folders, so each tile shows where its file is. */
  spansFolders: boolean
}) {
  const [pageCount, setPageCount] = useState(1)
  const layout = DENSITY_LAYOUT[density]
  const loaded = pageCount * PAGE_SIZE

  return (
    <InfiniteScrollList
      nextLoadingEnabled={true}
      isLoadingNext={false}
      hasNextData={loaded < firstPageTotal}
      onLoadNextData={() => setPageCount(c => (c * PAGE_SIZE < firstPageTotal ? c + 1 : c))}>
      <Grid $minTileWidth={layout.minTileWidth}>
        {Array.from({ length: pageCount }, (_, i) => (
          <Suspense key={i} fallback={null}>
            <LocalMapPage
              query={{ ...query, offset: i * PAGE_SIZE, limit: PAGE_SIZE }}
              version={version}
              imageSize={layout.imageSize}
              spansFolders={spansFolders}
              pick={pick}
            />
          </Suspense>
        ))}
      </Grid>
    </InfiniteScrollList>
  )
}

function LocalMapPage({
  query,
  version,
  imageSize,
  spansFolders,
  pick,
}: {
  query: LocalMapQuery
  version: number
  imageSize: number
  spansFolders: boolean
  pick?: MapPickOptions
}) {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const page = use(readLocalMaps(query, version))
  const files = page.ok ? page.value.files : []
  const hashes = files.flatMap(f => (f.hash ? [f.hash] : []))
  const [{ data, fetching }] = useQuery({
    query: LocalKnownMapsQuery,
    variables: { hashes },
    pause: !selfUser || !hashes.length,
    context: NO_SUSPENSE_CONTEXT,
  })
  const [, addToLibrary] = useMutation(LocalAddToLibraryMutation)
  const uploads = useLocalMapUploads()
  const uploadFile = useUploadLocalMapFile()

  // `MapFile.id` is the hash base64-encoded; the index has it hex-encoded
  const known = new Map((data?.mapsByHash ?? []).map(map => [mapFileIdToHash(map.file.id), map]))
  const checking = !selfUser || fetching || (!data && hashes.length > 0)

  const chooseUnknown = (file: LocalMapFile) => {
    if (!selfUser) {
      redirectToLogin(push)
      return
    }
    uploadFile(file, map => {
      if (pick) {
        pick.onPick(map.id)
      } else {
        push(urlForMap(map.id, map.name))
      }
    })
  }

  const pickKnown = (mapId: SbMapId) => {
    // Picking a map from this PC also puts it in the viewer's maps, as uploading it would have
    addToLibrary({ id: mapId }).catch(() => {})
    pick!.onPick(mapId)
  }

  if (!page.ok) {
    return null
  }
  return (
    <>
      {files.map(file => {
        const map = file.hash ? known.get(file.hash) : undefined
        if (map) {
          const mapId = map.id as SbMapId
          return (
            <MapTile
              key={file.id}
              map={map}
              signal={MapTileSignal.Total}
              imageSize={imageSize}
              pick={
                pick
                  ? {
                      onPick: () => pickKnown(mapId),
                      selected: pick.selectedMapId === mapId,
                      queuePositions: pick.queuePositions?.get(mapId),
                      pending: pick.pendingMapId === mapId,
                      failed: pick.failedMapId === mapId,
                      disabled:
                        !!pick.disabled || (!!pick.pendingMapId && pick.pendingMapId !== mapId),
                    }
                  : undefined
              }
            />
          )
        }
        return (
          <LocalMapTile
            key={file.id}
            file={file}
            checking={checking}
            upload={uploads.get(file.path)}
            folderLabel={spansFolders ? fileFolderLabel(file.folder, t) : undefined}
            onActivate={() => chooseUnknown(file)}
          />
        )
      })}
    </>
  )
}

/**
 * A link to the maps on this PC that match `search`, shown beside another tab's results so a map's
 * whereabouts don't hide it. Shows nothing when none match.
 */
export function LocalMatchesLink({ search, onOpen }: { search: string; onOpen: () => void }) {
  return (
    <Suspense fallback={null}>
      <LocalMatchesLinkContent search={search} onOpen={onOpen} />
    </Suspense>
  )
}

function LocalMatchesLinkContent({ search, onOpen }: { search: string; onOpen: () => void }) {
  const { t } = useTranslation()
  const version = useDeferredValue(useLocalMapsVersion())
  const deferredSearch = useDeferredValue(search)
  const read = use(
    readLocalMaps(
      { search: deferredSearch, sort: LocalMapSort.Name, offset: 0, limit: 0 },
      version,
    ),
  )
  if (!read.ok || read.value.total === 0) {
    return null
  }
  return (
    <TextButton
      label={t('maps.local.matchesOnThisPc', {
        defaultValue: '{{count}} on this PC',
        count: read.value.total,
      })}
      iconStart='computer'
      onClick={onOpen}
    />
  )
}
