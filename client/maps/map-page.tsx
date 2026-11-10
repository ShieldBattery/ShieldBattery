import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { useRoute } from 'wouter'
import { useLocationProperty } from 'wouter/use-browser-location'
import { GameType, gameTypeToLabel } from '../../common/games/game-type'
import {
  ALL_MAP_PAGE_SUB_PAGES,
  MAP_PAGE_FILE_PARAM,
  mapFileIdFromSegment,
  mapIdFromRouteSegment,
  MapPageId,
  MapPageSubPage,
} from '../../common/map-url'
import {
  filterColorCodes,
  makeMapFamilyId,
  makeSbMapId,
  SbMapId,
  Tileset,
  tilesetToName,
} from '../../common/maps'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { urlPath } from '../../common/urls'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { useTrackPageView } from '../analytics/analytics'
import { useSelfUser } from '../auth/auth-utils'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapKind } from '../gql/graphql'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadErrorRow } from '../lists/load-error-row'
import { RoomChip, SectionLabel } from '../lobbies/room/room-parts'
import { useCurrentMapPoolTypes } from '../matchmaking/map-pool-membership'
import { FilledButton, IconButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Card } from '../material/card'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useScrollMemory } from '../navigation/router-hooks'
import { replace } from '../navigation/routing'
import { makeServerUrl } from '../network/server-url'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  displayMedium,
  displaySmall,
  labelLarge,
  titleSmall,
} from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import {
  delistMap,
  openMapDownloadDialog,
  openMapFamilyActionDialog,
  openMapFamilyReportDialog,
  openMapPreviewDialog,
  regenMapImage,
  removeFromMyMaps,
  updateMap,
} from './action-creators'
import { MapBackButton } from './map-back-button'
import { DescriptionForm, NameForm } from './map-edit-forms'
import { correctedMapPageUrl, SelectedFileState, urlForMapFile } from './map-family-files'
import { useToggleMapFavorite } from './map-favorites'
import { useMapHostAction } from './map-host-action'
import { MapFileImage } from './map-image'
import { MapLiveGames, MapOpenLobbies, MapRecentGames } from './map-page-activity'
import { MapFilesCard, MapNotDefaultNotice } from './map-page-files'
import { MapGamesPage } from './map-page-games'
import { MapMatchupsCard, MapStatsCard } from './map-page-stats'
import { umsForceLayout } from './map-page-summaries'

const MapPageFamilyQuery = graphql(/* GraphQL */ `
  query MapPageFamily($id: UUID!, $canManageMaps: Boolean!) {
    mapFamily(id: $id) {
      id
      file {
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
        ...MapPageStats_FamilyFragment
        ...MapPageFiles_FamilyFragment
      }
    }
  }
`)

const MapPageFileQuery = graphql(/* GraphQL */ `
  query MapPageFile($id: SbMapId!, $canManageMaps: Boolean!) {
    map(id: $id) {
      id
      name
      kind
      family {
        id
        name
      }
      stats {
        id
      }
      file {
        id
        image256Url
        ...MapFileImage_FileFragment
      }
      ...MapPage_HeaderFragment
      ...MapPage_ActionsFragment
      ...MapPage_FactsFragment
      ...MapPage_HowToPlayFragment
      ...MapPageMatchups_MapFragment
      ...MapPageFiles_FileFragment
    }
  }
`)

/**
 * Requests results without suspending: the page renders its own loading state instead. Module-level so
 * the query sees the same context every render (a new object would make it start over).
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const NotFoundText = styled.div`
  ${bodyLarge};
  padding: 32px 16px;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

function MapNotFound() {
  const { t } = useTranslation()
  return (
    <CenteredContentContainer>
      <NotFoundText>{t('maps.page.notFound', 'This map could not be found.')}</NotFoundText>
    </CenteredContentContainer>
  )
}

/** The route for a map's page: `/maps/:id/:slug?/:subPage?`, with an optional `file` param. */
export function MapPageRoute() {
  const [match, params] = useRoute('/maps/:id/:slug?/:subPage?')
  const subPage = ALL_MAP_PAGE_SUB_PAGES.includes(params?.subPage as MapPageSubPage)
    ? (params?.subPage as MapPageSubPage)
    : undefined
  useTrackPageView(subPage ? urlPath`/maps/:id/${subPage}` : '/maps/:id')

  if (!match) {
    return null
  }

  const pageId = mapIdFromRouteSegment(params.id)
  if (!pageId) {
    return <MapNotFound />
  }

  return <MapPage key={pageId} pageId={pageId} subPage={subPage} />
}

export interface MapPageProps {
  /** The id in the page's path: a map's id, or a file's (which selects that file). */
  pageId: MapPageId
  subPage?: MapPageSubPage
  /**
   * Whether the page replaces the URL with the map's canonical one. Only pages showing a map page
   * outside its own route (dev pages) turn this off.
   */
  correctUrl?: boolean
}

/**
 * A map's page: everything about one map, and the ways to play it. The map's details come from
 * one of its files, the one the URL selects or else its default, while how much it's played and
 * its favorites are the map's as a whole.
 */
export function MapPage({ pageId, subPage, correctUrl = true }: MapPageProps) {
  const { t } = useTranslation()
  const canManageMaps = useHasAnyPermission('manageMaps')
  const pathname = useLocationProperty(() => location.pathname)
  const search = useLocationProperty(() => location.search)
  const fileParam = new URLSearchParams(search).get(MAP_PAGE_FILE_PARAM)
  const paramFileId = fileParam ? mapFileIdFromSegment(fileParam) : undefined

  const [{ data: familyData, error: familyError }, reexecuteFamily] = useQuery({
    query: MapPageFamilyQuery,
    variables: { id: pageId, canManageMaps },
    context: NO_SUSPENSE_CONTEXT,
  })
  const lookup = familyData?.mapFamily ?? undefined
  const family = lookup?.family
  const pathFileId = lookup?.file?.id
  const selectedId = pathFileId ?? paramFileId ?? family?.current.id

  const [fileResult, reexecuteFile] = useQuery({
    query: MapPageFileQuery,
    variables: { id: selectedId ?? makeSbMapId(''), canManageMaps },
    pause: !selectedId,
    context: NO_SUSPENSE_CONTEXT,
  })
  // A result for another file (the one selected before) doesn't count
  const fileLoaded =
    !!selectedId && !!fileResult.data && fileResult.operation?.variables.id === selectedId
  const file = fileLoaded ? (fileResult.data?.map ?? undefined) : undefined

  let paramFile: SelectedFileState | undefined
  if (!pathFileId && paramFileId) {
    if (file) {
      paramFile = { kind: 'found', id: file.id, family: file.family }
    } else if (fileLoaded) {
      paramFile = { kind: 'missing' }
    } else {
      paramFile = { kind: 'loading' }
    }
  }

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  // The games list remembers and restores this container's scroll position itself.
  useScrollMemory(subPage === MapPageSubPage.Games ? null : scroller)

  // The server's page metadata builds the same canonical URL, or a page could keep redirecting
  const correctedUrl =
    family && correctUrl
      ? correctedMapPageUrl({
          pathname,
          search,
          subPage,
          family: { id: family.id, name: family.name },
          pathFileId,
          paramFile,
        })
      : undefined
  useEffect(() => {
    if (correctedUrl) {
      replace(correctedUrl, history.state)
    }
  }, [correctedUrl])

  const refresh = () => {
    reexecuteFamily({ requestPolicy: 'network-only' })
    reexecuteFile({ requestPolicy: 'network-only' })
  }

  let content: React.ReactNode
  if (!familyData) {
    content = familyError ? (
      <NotFoundText>
        <LoadErrorRow
          message={t('maps.page.loadError', "Couldn't load this map")}
          onRetry={refresh}
        />
      </NotFoundText>
    ) : (
      <LoadingDotsArea />
    )
  } else if (!family) {
    content = <NotFoundText>{t('maps.page.notFound', 'This map could not be found.')}</NotFoundText>
  } else if (!file || file.family.id !== family.id || correctedUrl) {
    // Either still loading, or the URL is about to change to the file's own map
    content =
      fileResult.error && !fileResult.fetching ? (
        <NotFoundText>
          <LoadErrorRow
            message={t('maps.page.loadError', "Couldn't load this map")}
            onRetry={refresh}
          />
        </NotFoundText>
      ) : (
        <LoadingDotsArea />
      )
  } else if (subPage === MapPageSubPage.Games) {
    content = (
      <MapGamesPage
        mapId={makeMapFamilyId(family.id)}
        mapName={filterColorCodes(family.name)}
        backUrl={urlForMapFile(family, file.id)}
        scrollParent={scroller}
      />
    )
  } else {
    const fileIds = family.files.map(f => f.id)
    const familyFileIds = fileIds.includes(file.id) ? fileIds : [...fileIds, file.id]
    content = (
      <PageContent>
        <MapBackButton />
        <Columns>
          <LeftColumn>
            <MapHero mapId={file.id} name={filterColorCodes(file.name)} file={file.file} />
            <MapFacts map={file} />
            <MapFilesCard family={family} selected={file} />
          </LeftColumn>
          <RightColumn>
            <MapNotDefaultNotice family={family} selectedId={file.id} />
            <MapHeaderAndActions
              header={file}
              actions={file}
              family={{
                id: family.id,
                name: family.name,
                current: family.current,
                fileCount: familyFileIds.length,
              }}
              onChanged={refresh}
            />
            <MapStatsCard family={family} kind={file.kind} />
            <MapMatchupsCard map={file} />
            <MapHowToPlay map={file} />
            {file.kind === MapKind.Melee ? <MapLiveGames mapIds={familyFileIds} /> : null}
            <MapOpenLobbies mapIds={familyFileIds} />
            <MapRecentGames
              mapId={makeMapFamilyId(family.id)}
              allGamesUrl={urlForMapFile(family, file.id, MapPageSubPage.Games)}
            />
          </RightColumn>
        </Columns>
      </PageContent>
    )
  }

  return <CenteredContentContainer ref={setScroller}>{content}</CenteredContentContainer>
}

/** The page's width below which its two columns stack into one. */
const SINGLE_COLUMN_BELOW_PX = 760

const PageContent = styled.div`
  padding-block: 16px 48px;
  container: map-page / inline-size;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
`

const Columns = styled.div`
  width: 100%;

  display: grid;
  grid-template-columns: clamp(220px, 40%, 420px) minmax(0, 1fr);
  align-items: start;
  gap: 32px;

  @container map-page (width < ${SINGLE_COLUMN_BELOW_PX}px) {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }
`

const LeftColumn = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 16px;

  @container map-page (width < ${SINGLE_COLUMN_BELOW_PX}px) {
    width: 100%;
    max-width: 420px;
  }
`

const RightColumn = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 20px;
`

const HeroFrame = styled.div`
  ${elevationPlus1};
  width: 100%;
  display: block;

  border-radius: 8px;
  overflow: hidden;
  background-color: var(--theme-container);
`

const HeroButton = styled.button`
  ${buttonReset};
  ${elevationPlus1};
  width: 100%;
  display: block;

  border-radius: 8px;
  overflow: hidden;
  background-color: var(--theme-container);
  cursor: zoom-in;

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: 2px;
  }
`

function MapHero({
  mapId,
  name,
  file,
}: {
  mapId: SbMapId
  name: string
  file: React.ComponentProps<typeof MapFileImage>['file'] & { image256Url: string }
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const image = (
    <MapFileImage file={file} name={name} size={512} showSpawns={true} loading='eager' />
  )
  // A map whose images couldn't be rendered has nothing to zoom into.
  if (!file.image256Url) {
    return <HeroFrame>{image}</HeroFrame>
  }

  return (
    <HeroButton
      type='button'
      aria-label={t('maps.thumbnail.showMapPreview', 'Show map preview')}
      onClick={() => dispatch(openMapPreviewDialog(mapId))}>
      {image}
    </HeroButton>
  )
}

const MapPage_FactsFragment = graphql(/* GraphQL */ `
  fragment MapPage_FactsFragment on SbMap {
    id
    kind
    playerCount
    file {
      id
      width
      height
      tileset
      isEud
      umsForces {
        name
        teamId
        players {
          playerId
          isComputer
        }
      }
      analysis {
        id
        baseCount
      }
    }
  }
`)

const FactsCard = styled(Card)`
  padding: 4px 16px;
`

const FactRow = styled.div`
  padding-block: 10px;

  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }
`

const FactLabel = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const FactValue = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface);
  text-align: right;
  font-variant-numeric: tabular-nums;
`

function MapFacts({ map: mapRef }: { map: FragmentType<typeof MapPage_FactsFragment> }) {
  const { t } = useTranslation()
  const map = useFragment(MapPage_FactsFragment, mapRef)
  const { file } = map
  const isUms = map.kind === MapKind.Ums

  const facts: Array<[label: string, value: React.ReactNode]> = [
    [t('maps.page.size', 'Size'), `${file.width}×${file.height}`],
    [t('maps.page.tileset', 'Tileset'), tilesetToName(file.tileset as Tileset, t)],
    [t('maps.page.players', 'Players'), map.playerCount],
    [
      t('maps.page.type', 'Type'),
      gameTypeToLabel(isUms ? GameType.UseMapSettings : GameType.Melee, t),
    ],
  ]
  if (isUms) {
    const layout = umsForceLayout(file.umsForces)
    if (layout) {
      const teams = layout.teams.join(` ${t('maps.page.forceVersus', 'vs')} `)
      facts.push([
        t('maps.page.forces', 'Forces'),
        layout.computers > 0
          ? t('maps.page.forcesWithComputers', {
              defaultValue: '{{teams}} + {{count}} computers',
              defaultValue_one: '{{teams}} + {{count}} computer',
              teams,
              count: layout.computers,
            })
          : teams,
      ])
    }
  } else {
    facts.push([t('maps.page.bases', 'Bases'), file.analysis?.baseCount ?? '—'])
  }
  if (file.isEud) {
    facts.push([t('maps.page.eud', 'EUD'), t('maps.page.eudRemasteredOnly', 'Remastered only')])
  }

  return (
    <FactsCard>
      {facts.map(([label, value]) => (
        <FactRow key={label}>
          <FactLabel>{label}</FactLabel>
          <FactValue>{value}</FactValue>
        </FactRow>
      ))}
    </FactsCard>
  )
}

const MapPage_HeaderFragment = graphql(/* GraphQL */ `
  fragment MapPage_HeaderFragment on SbMap {
    id
    name
    description
    kind
    listed
    official
    publishedAt
    publisher {
      id
      name
    }
    file {
      id
      originalName
      originalDescription
    }
    moderation @include(if: $canManageMaps) {
      id
      delistedAt
      delistedBy {
        id
        name
      }
    }
  }
`)

const publishedDateFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

const Header = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

const Title = styled.h1`
  ${displayMedium};
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--theme-on-surface);

  @container map-page (width < ${SINGLE_COLUMN_BELOW_PX}px) {
    ${displaySmall};
  }
`

const Byline = styled.div`
  ${bodySmall};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;

  color: var(--theme-on-surface-variant);
`

const Notice = styled.div`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: 8px;

  color: var(--theme-on-surface-variant);
`

/** Text with a username in the middle of it. */
const InlineParts = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
`

const Description = styled.div`
  ${bodyMedium};
  max-width: 640px;

  color: var(--theme-on-surface-variant);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
`

const FromFile = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const FromFileName = styled.div`
  ${titleSmall};
  overflow-wrap: anywhere;
  user-select: text;
`

function MapHeader({
  map: mapRef,
  editing,
  onEditDone,
  onChanged,
}: {
  map: FragmentType<typeof MapPage_HeaderFragment>
  editing: 'name' | 'description' | undefined
  onEditDone: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const map = useFragment(MapPage_HeaderFragment, mapRef)
  const publishedDate = useFormat(publishedDateFormat)
  const poolTypes = useCurrentMapPoolTypes(map.id)

  const name = filterColorCodes(map.name)
  const description = filterColorCodes(map.description)
  const originalName = filterColorCodes(map.file.originalName)
  const originalDescription = filterColorCodes(map.file.originalDescription)
  const isUms = map.kind === MapKind.Ums
  // A UMS map's own description is how to play it, which has a card of its own.
  const showDescription = !!description && !(isUms && description === originalDescription)
  const fromFileName = originalName !== name ? originalName : undefined
  const fromFileDescription =
    !isUms && originalDescription && originalDescription !== description
      ? originalDescription
      : undefined
  const delisted = map.moderation?.delistedAt ? map.moderation : undefined

  const saveChange = (change: { name?: string; description?: string }) => {
    onEditDone()
    dispatch(
      updateMap(map.id, change, {
        onSuccess: onChanged,
        onError: () => {
          snackbarController.showSnackbar(
            t('maps.page.updateError', 'An error occurred while updating the map'),
          )
        },
      }),
    )
  }

  const hasChips = map.official || !map.listed || poolTypes.length > 0

  let descriptionElem: React.ReactNode
  if (editing === 'description') {
    descriptionElem = (
      <DescriptionForm
        initialDescription={map.description}
        onSubmit={({ description }) => saveChange({ description })}
        onCancel={onEditDone}
      />
    )
  } else if (showDescription) {
    descriptionElem = <Description>{description}</Description>
  }

  return (
    <Header>
      {hasChips ? (
        <Chips>
          {map.official ? <RoomChip>{t('maps.page.official', 'Official')}</RoomChip> : null}
          {!map.listed ? <RoomChip>{t('maps.page.unlisted', 'Unlisted')}</RoomChip> : null}
          {poolTypes.map(type => {
            const label = matchmakingTypeToLabel(type, t)
            return (
              <Tooltip
                key={type}
                text={t(
                  'maps.thumbnail.mapPoolChipTooltip',
                  'In the current {{mode}} ladder map pool',
                  { mode: label },
                )}
                position='bottom'>
                <RoomChip>{label}</RoomChip>
              </Tooltip>
            )
          })}
        </Chips>
      ) : null}
      {editing === 'name' ? (
        <NameForm
          initialName={map.name}
          onSubmit={({ name }) => saveChange({ name })}
          onCancel={onEditDone}
        />
      ) : (
        <Title>{name}</Title>
      )}
      {map.listed && map.publisher && map.publishedAt ? (
        <Byline>
          {t('maps.page.publishedBy', 'Published by')}
          <ConnectedUsername userId={map.publisher.id} />
          {'·'}
          <span>{publishedDate.format(new Date(map.publishedAt))}</span>
        </Byline>
      ) : null}
      {!map.listed ? (
        <Notice>
          <MaterialIcon icon='link' size={20} />
          {t('maps.page.unlistedNotice', 'Only people with the link can see this map.')}
        </Notice>
      ) : null}
      {delisted?.delistedAt ? (
        <Notice>
          <MaterialIcon icon='visibility_off' size={20} />
          {delisted.delistedBy ? (
            <InlineParts>
              {t('maps.page.delistedBy', 'Delisted by')}
              <ConnectedUsername userId={delisted.delistedBy.id} />
              {t('maps.page.delistedOn', {
                defaultValue: 'on {{date}}',
                date: publishedDate.format(new Date(delisted.delistedAt)),
              })}
            </InlineParts>
          ) : (
            t('maps.page.delistedAt', {
              defaultValue: 'Delisted on {{date}}',
              date: publishedDate.format(new Date(delisted.delistedAt)),
            })
          )}
        </Notice>
      ) : null}
      {descriptionElem}
      {fromFileName || fromFileDescription ? (
        <FromFile>
          <SectionLabel>{t('maps.page.fromMapFile', 'From the map file')}</SectionLabel>
          {fromFileName ? <FromFileName>{fromFileName}</FromFileName> : null}
          {fromFileDescription ? <Description>{fromFileDescription}</Description> : null}
        </FromFile>
      ) : null}
    </Header>
  )
}

const MapPage_ActionsFragment = graphql(/* GraphQL */ `
  fragment MapPage_ActionsFragment on SbMap {
    id
    name
    listed
    isFavorited
    inLibrary
    publisher {
      id
    }
  }
`)

const ActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

/** What the page's actions need to know about the map the shown file is in. */
interface ActionsFamily {
  id: string
  name: string
  current: { id: SbMapId }
  /** How many of the map's files the viewer can see. */
  fileCount: number
}

/** The map's header, and the actions under it (which can put the header's text into editing). */
function MapHeaderAndActions({
  header,
  actions,
  family,
  onChanged,
}: {
  header: FragmentType<typeof MapPage_HeaderFragment>
  actions: FragmentType<typeof MapPage_ActionsFragment>
  family: ActionsFamily
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<'name' | 'description'>()
  return (
    <>
      <MapHeader
        map={header}
        editing={editing}
        onEditDone={() => setEditing(undefined)}
        onChanged={onChanged}
      />
      <MapActions map={actions} family={family} onEdit={setEditing} onChanged={onChanged} />
    </>
  )
}

function MapActions({
  map: mapRef,
  family,
  onEdit,
  onChanged,
}: {
  map: FragmentType<typeof MapPage_ActionsFragment>
  family: ActionsFamily
  onEdit: (field: 'name' | 'description') => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const map = useFragment(MapPage_ActionsFragment, mapRef)
  const selfUser = useSelfUser()
  const canManageMaps = useHasAnyPermission('manageMaps')
  const { isLobbyHost, play } = useMapHostAction()

  const [toggleFavorite, favoritePending] = useToggleMapFavorite()

  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  const showError = (message: string) => snackbarController.showSnackbar(message)

  const onCopyLink = () => {
    const url = new URL(makeServerUrl(urlForMapFile(family, map.id)), location.origin).toString()
    navigator.clipboard
      .writeText(url)
      .then(() => snackbarController.showSnackbar(t('maps.page.linkCopied', 'Link copied')))
      .catch(() => showError(t('maps.page.linkCopyError', "Couldn't copy the link")))
  }

  const menuItems: Array<[text: string, handler: () => void]> = []
  if (map.inLibrary) {
    menuItems.push([
      t('maps.thumbnail.removeFromMyMaps', 'Remove from my maps'),
      () =>
        dispatch(
          removeFromMyMaps(map.id, {
            onSuccess: () => {
              snackbarController.showSnackbar(
                t('maps.server.removedFromMyMaps', 'Removed from your maps'),
              )
              onChanged()
            },
            onError: () =>
              showError(
                t(
                  'maps.server.removeFromMyMapsError',
                  'An error occurred while removing the map from your maps',
                ),
              ),
          }),
        ),
    ])
  }
  // Unlisted maps always show their file's own name and description, so only listed maps can be
  // edited
  if (canManageMaps && map.listed) {
    menuItems.push(
      [t('maps.details.editName', 'Edit name'), () => onEdit('name')],
      [t('maps.details.editDescription', 'Edit description'), () => onEdit('description')],
      [
        t('maps.thumbnail.delistMap', 'Delist'),
        () =>
          dispatch(
            delistMap(map.id, {
              onSuccess: () => {
                snackbarController.showSnackbar(t('maps.server.delisted', 'Map delisted'))
                onChanged()
              },
              onError: () =>
                showError(
                  t('maps.server.delistError', 'An error occurred while delisting the map'),
                ),
            }),
          ),
      ],
    )
  }
  if (canManageMaps) {
    menuItems.push(
      [
        t('maps.thumbnail.regenerateImage', 'Regenerate image'),
        () =>
          dispatch(
            regenMapImage(map.id, {
              onSuccess: () => {
                snackbarController.showSnackbar(t('maps.server.regenerated', 'Images regenerated'))
                onChanged()
              },
              onError: () =>
                showError(
                  t('maps.server.regenerateError', 'An error occurred while regenerating images'),
                ),
            }),
          ),
      ],
      // Admin-only, so not translated
      [
        'Merge into another map…',
        () =>
          dispatch(
            openMapFamilyActionDialog({
              action: 'merge',
              familyId: family.id,
              selectedId: map.id,
            }),
          ),
      ],
    )
  } else if (selfUser) {
    // Staff fix these themselves, from the Files card and this menu
    if (family.fileCount > 1) {
      menuItems.push([
        t('maps.report.wrongMapAction', "This file isn't part of this map"),
        () =>
          dispatch(
            openMapFamilyReportDialog({ kind: 'wrongMap', familyId: family.id, fileId: map.id }),
          ),
      ])
    }
    menuItems.push([
      t('maps.report.sameMapAction', 'This map is the same as…'),
      () =>
        dispatch(
          openMapFamilyReportDialog({ kind: 'sameMap', familyId: family.id, fileId: map.id }),
        ),
    ])
  }

  const favoriteLabel = map.isFavorited
    ? t('maps.thumbnail.removeFromFavorites', 'Remove from favorites')
    : t('maps.thumbnail.addToFavorites', 'Add to favorites')

  return (
    <ActionRow>
      {isLobbyHost ? (
        <FilledButton
          label={t('maps.page.useInMyLobby', 'Use in my lobby')}
          iconStart='swap_horiz'
          onClick={() => play(map.id)}
        />
      ) : (
        <FilledButton
          label={t('maps.page.hostLobby', 'Host a lobby')}
          iconStart='add'
          onClick={() => play(map.id)}
        />
      )}
      <Tooltip text={favoriteLabel} position='bottom' tabIndex={-1}>
        <IconButton
          icon={<MaterialIcon icon='star' filled={map.isFavorited} />}
          ariaLabel={favoriteLabel}
          disabled={favoritePending}
          onClick={() => toggleFavorite(map)}
        />
      </Tooltip>
      <Tooltip text={t('maps.thumbnail.downloadMap', 'Download')} position='bottom' tabIndex={-1}>
        <IconButton
          icon={<MaterialIcon icon='download' />}
          ariaLabel={t('maps.thumbnail.downloadMap', 'Download')}
          onClick={() => dispatch(openMapDownloadDialog(map.id))}
        />
      </Tooltip>
      <Tooltip text={t('maps.page.copyLink', 'Copy link')} position='bottom' tabIndex={-1}>
        <IconButton
          icon={<MaterialIcon icon='link' />}
          ariaLabel={t('maps.page.copyLink', 'Copy link')}
          onClick={onCopyLink}
        />
      </Tooltip>
      {menuItems.length ? (
        <>
          <Tooltip
            text={t('maps.thumbnail.mapActions', 'Map actions')}
            position='bottom'
            tabIndex={-1}>
            <IconButton
              ref={anchorRef}
              icon={<MaterialIcon icon='more_vert' />}
              ariaLabel={t('maps.thumbnail.mapActions', 'Map actions')}
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
            <MenuList>
              {menuItems.map(([text, handler]) => (
                <MenuItem
                  key={text}
                  text={text}
                  onClick={() => {
                    closeMenu()
                    handler()
                  }}
                />
              ))}
            </MenuList>
          </Popover>
        </>
      ) : null}
    </ActionRow>
  )
}

const MapPage_HowToPlayFragment = graphql(/* GraphQL */ `
  fragment MapPage_HowToPlayFragment on SbMap {
    id
    kind
    file {
      id
      originalDescription
    }
  }
`)

const HowToPlayCard = styled(Card)`
  padding: 16px 20px;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const HowToPlayText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
`

/** A UMS map's own description, which is where its author explains how to play it. */
function MapHowToPlay({ map: mapRef }: { map: FragmentType<typeof MapPage_HowToPlayFragment> }) {
  const { t } = useTranslation()
  const map = useFragment(MapPage_HowToPlayFragment, mapRef)
  const text = filterColorCodes(map.file.originalDescription).trim()
  if (map.kind !== MapKind.Ums || !text) {
    return null
  }

  return (
    <HowToPlayCard>
      <SectionLabel>{t('maps.page.howToPlay', 'How to play')}</SectionLabel>
      <HowToPlayText>{text}</HowToPlayText>
    </HowToPlayCard>
  )
}
