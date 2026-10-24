import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { useRoute } from 'wouter'
import { GameType, gameTypeToLabel } from '../../common/games/game-type'
import {
  ALL_MAP_PAGE_SUB_PAGES,
  mapIdFromRouteSegment,
  MapPageSubPage,
  mapSlug,
  urlForMap,
} from '../../common/map-url'
import { filterColorCodes, SbMapId, Tileset, tilesetToName } from '../../common/maps'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { encodePrettyId } from '../../common/pretty-id'
import { urlPath } from '../../common/urls'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { useTrackPageView } from '../analytics/analytics'
import { redirectToLogin, useSelfUser } from '../auth/auth-utils'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapKind, MapLinkSource } from '../gql/graphql'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadErrorRow } from '../lists/load-error-row'
import { updateLobbySettings } from '../lobbies/action-creators'
import { isInLobby } from '../lobbies/lobby-reducer'
import { navigateToLobby } from '../lobbies/lobby-url'
import { RoomChip, SectionLabel } from '../lobbies/room/room-parts'
import { useCurrentMapPoolTypes } from '../matchmaking/map-pool-membership'
import { FilledButton, IconButton, TextButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Card } from '../material/card'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useScrollMemory } from '../navigation/router-hooks'
import { push, replace } from '../navigation/routing'
import { makeServerUrl } from '../network/server-url'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
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
  openMapFamilyLinkDialog,
  openMapPreviewDialog,
  regenMapImage,
  removeFromMyMaps,
  updateMap,
} from './action-creators'
import { DescriptionForm, NameForm } from './map-edit-forms'
import { useToggleMapFavorite } from './map-favorites'
import { MapFileImage } from './map-image'
import { MapLiveGames, MapOpenLobbies, MapRecentGames } from './map-page-activity'
import { MapFamilyCard, MapNewerVersionBanner } from './map-page-family'
import { MapGamesPage } from './map-page-games'
import { MapMatchupsCard, MapStatsCard } from './map-page-stats'
import { umsForceLayout } from './map-page-summaries'

const MapPageQuery = graphql(/* GraphQL */ `
  query MapPage($id: SbMapId!, $canManageMaps: Boolean!) {
    map(id: $id) {
      id
      name
      kind
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
      ...MapPageStats_MapFragment
      ...MapPageMatchups_MapFragment
      ...MapPage_NewerVersionFragment
      ...MapPage_FamilyFragment
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

/** The route for a map's page: `/maps/:id/:slug?/:subPage?`. */
export function MapPageRoute() {
  const [match, params] = useRoute('/maps/:id/:slug?/:subPage?')
  const subPage = ALL_MAP_PAGE_SUB_PAGES.includes(params?.subPage as MapPageSubPage)
    ? (params?.subPage as MapPageSubPage)
    : undefined
  useTrackPageView(subPage ? urlPath`/maps/:id/${subPage}` : '/maps/:id')

  if (!match) {
    return null
  }

  const mapId = mapIdFromRouteSegment(params.id)
  if (!mapId) {
    return <MapNotFound />
  }

  return (
    <MapPage
      key={mapId}
      mapId={mapId}
      idSegment={params.id}
      slugSegment={params.slug}
      subPageSegment={params.subPage}
      subPage={subPage}
    />
  )
}

/**
 * Replaces the URL with the map's canonical one when it differs from it: an old id of the map, a
 * raw UUID id, a slug that doesn't match the map's name, or an unknown sub-page. The server's page
 * metadata uses the same `mapSlug`, or a wrong-slug URL could redirect in a loop.
 */
function useCorrectMapUrl(
  map: { id: SbMapId; name: string } | undefined,
  segments: { idSegment: string; slugSegment?: string; subPageSegment?: string },
  subPage: MapPageSubPage | undefined,
) {
  const { idSegment, slugSegment, subPageSegment } = segments
  useEffect(() => {
    if (!map) {
      return
    }
    if (
      idSegment !== encodePrettyId(map.id) ||
      slugSegment !== mapSlug(map.name) ||
      subPageSegment !== subPage
    ) {
      replace({ pathname: urlForMap(map.id, map.name, subPage), search: location.search })
    }
  }, [map, idSegment, slugSegment, subPageSegment, subPage])
}

export interface MapPageProps {
  mapId: SbMapId
  idSegment: string
  slugSegment?: string
  subPageSegment?: string
  subPage?: MapPageSubPage
}

/** A map's page: everything about one map, and the ways to play it. */
export function MapPage({ mapId, idSegment, slugSegment, subPageSegment, subPage }: MapPageProps) {
  const { t } = useTranslation()
  const canManageMaps = useHasAnyPermission('manageMaps')
  const [{ data, error }, reexecuteQuery] = useQuery({
    query: MapPageQuery,
    variables: { id: mapId, canManageMaps },
    context: NO_SUSPENSE_CONTEXT,
  })

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  // The games list remembers and restores this container's scroll position itself.
  useScrollMemory(subPage === MapPageSubPage.Games ? null : scroller)

  const map = data?.map ?? undefined
  useCorrectMapUrl(
    map ? { id: map.id, name: map.name } : undefined,
    { idSegment, slugSegment, subPageSegment },
    subPage,
  )

  const refresh = () => reexecuteQuery({ requestPolicy: 'network-only' })

  let content: React.ReactNode
  if (!data) {
    content = error ? (
      <NotFoundText>
        <LoadErrorRow
          message={t('maps.page.loadError', "Couldn't load this map")}
          onRetry={refresh}
        />
      </NotFoundText>
    ) : (
      <LoadingDotsArea />
    )
  } else if (!map) {
    content = <NotFoundText>{t('maps.page.notFound', 'This map could not be found.')}</NotFoundText>
  } else if (subPage === MapPageSubPage.Games) {
    content = (
      <MapGamesPage mapId={map.id} mapName={filterColorCodes(map.name)} scrollParent={scroller} />
    )
  } else {
    content = (
      <PageContent>
        <BackButton />
        <Columns>
          <LeftColumn>
            <MapHero mapId={map.id} name={filterColorCodes(map.name)} file={map.file} />
            <MapFacts map={map} />
            <MapFamilyCard map={map} />
          </LeftColumn>
          <RightColumn>
            <MapNewerVersionBanner map={map} />
            <MapHeaderAndActions header={map} actions={map} onChanged={refresh} />
            <MapStatsCard map={map} />
            <MapMatchupsCard map={map} />
            <MapHowToPlay map={map} />
            {map.kind === MapKind.Melee ? (
              <MapLiveGames mapIds={mapId === map.id ? [map.id] : [map.id, mapId]} />
            ) : null}
            <MapOpenLobbies mapId={map.id} />
            {map.stats ? <MapRecentGames mapId={map.id} mapName={map.name} /> : null}
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

/** Whether the app has an earlier entry in its own history to go back to. */
function canGoBackInApp(): boolean {
  const navigation = (window as { navigation?: { canGoBack?: boolean } }).navigation
  return !!navigation?.canGoBack
}

function BackButton() {
  const { t } = useTranslation()
  return (
    <TextButton
      label={t('common.actions.back', 'Back')}
      iconStart='arrow_back'
      onClick={() => {
        if (canGoBackInApp()) {
          history.back()
        } else {
          push('/maps')
        }
      }}
    />
  )
}

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
    familyMember {
      id
      isCurrent
      source
    }
  }
`)

const MapPagePinCurrentMutation = graphql(/* GraphQL */ `
  mutation MapPagePinCurrent($mapId: SbMapId!) {
    mapFamilyUpdateMember(mapId: $mapId, pinnedCurrent: true) {
      id
    }
  }
`)

const MapPagePublisherUnlinkMutation = graphql(/* GraphQL */ `
  mutation MapPagePublisherUnlink($mapId: SbMapId!) {
    mapFamilyPublisherUnlink(mapId: $mapId) {
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

/** The map's header, and the actions under it (which can put the header's text into editing). */
function MapHeaderAndActions({
  header,
  actions,
  onChanged,
}: {
  header: FragmentType<typeof MapPage_HeaderFragment>
  actions: FragmentType<typeof MapPage_ActionsFragment>
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
      <MapActions map={actions} onEdit={setEditing} onChanged={onChanged} />
    </>
  )
}

function MapActions({
  map: mapRef,
  onEdit,
  onChanged,
}: {
  map: FragmentType<typeof MapPage_ActionsFragment>
  onEdit: (field: 'name' | 'description') => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const map = useFragment(MapPage_ActionsFragment, mapRef)
  const selfUser = useSelfUser()
  const canManageMaps = useHasAnyPermission('manageMaps')

  const inLobby = useAppSelector(s => isInLobby(s.lobby))
  const lobbyId = useAppSelector(s => s.lobby.info.id)
  const lobbyName = useAppSelector(s => s.lobby.info.name)
  const lobbyHostId = useAppSelector(s => s.lobby.info.host.userId)
  const lobbyMapId = useAppSelector(s => s.lobby.info.map?.id)
  const isLobbyHost = IS_ELECTRON && inLobby && !!selfUser && lobbyHostId === selfUser.id

  const [toggleFavorite, favoritePending] = useToggleMapFavorite()
  const [, pinCurrent] = useMutation(MapPagePinCurrentMutation)
  const [, publisherUnlink] = useMutation(MapPagePublisherUnlinkMutation)

  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  const showError = (message: string) => snackbarController.showSnackbar(message)

  const onHost = () => {
    if (!IS_ELECTRON) {
      dispatch(openDialog({ type: DialogType.Download }))
    } else if (!selfUser) {
      redirectToLogin(push)
    } else {
      push(urlPath`/play/lobbies/create?map=${map.id}`)
    }
  }

  const onUseInLobby = () => {
    if (lobbyMapId === map.id) {
      navigateToLobby(lobbyId, lobbyName)
      return
    }
    dispatch(
      updateLobbySettings(
        { map: map.id },
        {
          onSuccess: () => navigateToLobby(lobbyId, lobbyName),
          onError: () =>
            showError(
              t(
                'maps.page.useInLobbyError',
                "Couldn't change your lobby's map. It may not fit the lobby's current setup.",
              ),
            ),
        },
      ),
    )
  }

  const onCopyLink = () => {
    const url = new URL(makeServerUrl(urlForMap(map.id, map.name)), location.origin).toString()
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
  const isPublisher = !!selfUser && map.listed && map.publisher?.id === selfUser.id
  if (isPublisher && !canManageMaps) {
    menuItems.push([
      t('maps.page.linkRelatedMap', 'Link to a related map…'),
      () => dispatch(openMapFamilyLinkDialog(map.id, 'related')),
    ])
    if (map.familyMember && map.familyMember.source !== MapLinkSource.Moderator) {
      menuItems.push([
        t('maps.page.unlinkFromFamily', 'Unlink from versions & forks'),
        () => {
          publisherUnlink({ mapId: map.id })
            .then(result => {
              if (result.error) {
                throw result.error
              }
              snackbarController.showSnackbar(
                t('maps.page.unlinkedFromFamily', 'Unlinked from versions & forks'),
              )
              onChanged()
            })
            .catch(() => showError(t('maps.page.unlinkFromFamilyError', "Couldn't unlink the map")))
        },
      ])
    }
  } else if (selfUser && !canManageMaps) {
    menuItems.push([
      t('maps.page.suggestRelatedMap', 'Suggest a related map…'),
      () => dispatch(openMapFamilyLinkDialog(map.id, 'related')),
    ])
    if (map.familyMember) {
      menuItems.push([
        t('maps.page.reportWrongFamily', 'Report a wrong family…'),
        () => dispatch(openMapFamilyLinkDialog(map.id, 'wrongFamily')),
      ])
    }
  }
  if (canManageMaps) {
    menuItems.push([
      t('maps.page.editFamily', 'Edit family…'),
      () => push(urlPath`/admin/map-families/maps/${map.id}`),
    ])
    if (map.listed && map.familyMember && !map.familyMember.isCurrent) {
      menuItems.push([
        t('maps.page.pinAsCurrent', 'Pin as current version'),
        () => {
          pinCurrent({ mapId: map.id })
            .then(result => {
              if (result.error) {
                throw result.error
              }
              snackbarController.showSnackbar(
                t('maps.page.pinnedAsCurrent', 'Pinned as the current version'),
              )
              onChanged()
            })
            .catch(() =>
              showError(t('maps.page.pinAsCurrentError', "Couldn't pin the current version")),
            )
        },
      ])
    }
    menuItems.push([
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
          onClick={onUseInLobby}
        />
      ) : (
        <FilledButton
          label={t('maps.page.hostLobby', 'Host a lobby')}
          iconStart='add'
          onClick={onHost}
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
