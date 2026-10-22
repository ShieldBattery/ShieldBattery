import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameType, gameTypeToLabel, isTeamType } from '../../../common/games/game-type'
import { LobbyVisibility } from '../../../common/lobbies'
import { MapInfoJson, SbMapId } from '../../../common/maps'
import { FileDropZone } from '../../file-browser/file-drop-zone'
import { MaterialIcon } from '../../icons/material/material-icon'
import { MapPicker, MapPickerMode, useMapPickerSession } from '../../maps/map-picker'
import { MAP_FILE_EXTENSIONS, useUploadMapFiles } from '../../maps/map-uploads'
import { IconButton } from '../../material/button'
import { elevationPlus1 } from '../../material/shadows'
import { bodyLarge, bodySmall, singleLine, titleLarge } from '../../styles/typography'
import { GameSetupModel } from './game-setup-form'

/** Whether the map picker is open on a game setup page, and what for. */
export interface MapPickerState {
  /** What picks are for, while the picker is open. */
  mode: MapPickerMode | undefined
  /** Opens the picker for a lobby of `gameType`. */
  open: (mode: MapPickerMode, gameType: GameType) => void
  close: () => void
}

export function useMapPickerState(): MapPickerState {
  const session = useMapPickerSession()
  const [mode, setMode] = useState<MapPickerMode>()
  return {
    mode,
    open: (nextMode, gameType) => {
      session.prepare(gameType)
      setMode(nextMode)
    },
    close: () => setMode(undefined),
  }
}

const Root = styled.div`
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
`

const DropZone = styled(FileDropZone)`
  position: absolute;
  inset: 0;
  z-index: 1;
`

const DropContents = styled.div`
  ${elevationPlus1};
  ${bodyLarge};
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;

  background-color: rgb(from var(--theme-primary-container) r g b / 0.9);
  color: var(--theme-on-primary-container);
  pointer-events: none;
`

const FormScroller = styled.div<{ $hidden: boolean }>`
  flex-grow: 1;
  min-height: 0;
  contain: strict;
  overflow-y: auto;

  display: ${props => (props.$hidden ? 'none' : 'block')};
`

const Content = styled.div`
  max-width: 960px;
  margin: 0 auto;
  padding: 16px 24px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const Title = styled.div`
  ${titleLarge};
`

const FooterBar = styled.div<{ $hidden: boolean }>`
  flex-shrink: 0;
  /* Slightly wider than the 960px form column (24px beyond it on each side, matching the page's
     24px padding rhythm) so the bar frames the column without stretching across the whole
     container. */
  width: 100%;
  max-width: 1008px;
  margin: 0 auto;
  /* The bar doesn't reach the window edges, so it's framed as a contained surface: bordered and
     slightly rounded on the exposed sides, square along the bottom edge it sits flush against. */
  border: 1px solid var(--theme-outline-variant);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background-color: var(--theme-container-low);

  display: ${props => (props.$hidden ? 'none' : 'block')};
`

const FooterContent = styled.div`
  max-width: 960px;
  margin: 0 auto;
  padding: 10px 24px;

  display: flex;
  align-items: center;
  gap: 16px;
`

const SummaryText = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
  flex-grow: 1;
  min-width: 0;
`

export interface GameSetupPageProps {
  title: string
  /** When set, a back arrow is shown next to the title. */
  onBack?: () => void
  picker: MapPickerState
  /**
   * Called with each map picked in the picker, or uploaded by dropping its file on the page. It's
   * for the picker's mode while the picker is open, and is the lobby's new map otherwise. The
   * map's info is in the store by then.
   */
  onMapPicked: (mapId: SbMapId) => void
  /** The game type the form currently has, which decides the maps the picker starts on. */
  gameType: GameType
  /** The lobby's current map, marked in the picker. */
  selectedMapId?: SbMapId
  /** The maps in the lobby's queue, in order, marked in the picker when adding to the queue. */
  queuedMapIds?: ReadonlyArray<SbMapId>
  /** Whether the queue has room for more maps. */
  canQueueMore?: boolean
  /** One-line description of the current setup, shown in the footer bar. */
  summary: string
  /** Action button(s) for the footer bar. */
  footerActions: React.ReactNode
  children: React.ReactNode
}

/**
 * The page scaffolding shared by every surface that hosts `GameSetupForm`: a title header above the
 * 960px form column, the map picker that swaps in over the form when picking maps, and a footer bar
 * with a one-line summary and the caller's action buttons. The form itself stays mounted (but
 * hidden) while picking, so in-progress edits survive the round trip. Dropping a map file anywhere
 * on the page uploads it and picks it.
 */
export function GameSetupPage({
  title,
  onBack,
  picker,
  onMapPicked,
  gameType,
  selectedMapId,
  queuedMapIds,
  canQueueMore,
  summary,
  footerActions,
  children,
}: GameSetupPageProps) {
  const { t } = useTranslation()
  const pickerSession = useMapPickerSession()
  const browsing = picker.mode !== undefined

  const uploadFiles = useUploadMapFiles({
    onStart: () => {
      if (picker.mode === undefined) {
        picker.open(MapPickerMode.Map, gameType)
      }
      pickerSession.showUploads()
    },
    onUploaded: (map, files) => {
      // With several files there's no telling which one was meant, so they're only shown
      if (files.length === 1) {
        onMapPicked(map.id)
      }
    },
  })

  return (
    <Root>
      {picker.mode !== undefined ? (
        <MapPicker
          mode={picker.mode}
          selectedMapId={selectedMapId}
          queuedMapIds={queuedMapIds}
          canQueueMore={canQueueMore}
          onPick={onMapPicked}
          onUploadFiles={uploadFiles}
          onClose={picker.close}
        />
      ) : null}

      <FormScroller $hidden={browsing}>
        <Content>
          <Header>
            {onBack ? (
              <IconButton
                icon={<MaterialIcon icon='arrow_back' />}
                title={t('common.actions.back', 'Back')}
                onClick={onBack}
              />
            ) : null}

            <Title>{title}</Title>
          </Header>

          {children}
        </Content>
      </FormScroller>

      <FooterBar $hidden={browsing}>
        <FooterContent>
          <SummaryText>{summary}</SummaryText>
          {footerActions}
        </FooterContent>
      </FooterBar>

      <DropZone extensions={[...MAP_FILE_EXTENSIONS]} onFilesDropped={uploadFiles}>
        <DropContents>
          <MaterialIcon icon='upload_file' size={48} />
          {t('lobbies.gameSetup.dropToUpload', 'Drop a map here to upload it and use it.')}
        </DropContents>
      </DropZone>
    </Root>
  )
}

/**
 * Builds the footer bar's one-line description of the current setup: visibility, game type, the
 * slots/team-split part, the map name, and whether observers are allowed.
 */
export function formatGameSetupSummary(
  t: TFunction,
  {
    visibility,
    setup,
    mapInfo,
  }: {
    visibility: LobbyVisibility
    setup: ReadonlyDeep<GameSetupModel>
    mapInfo: ReadonlyDeep<MapInfoJson> | undefined
  },
): string {
  let slots: number | undefined
  if (mapInfo) {
    slots =
      setup.gameType === GameType.UseMapSettings ? mapInfo.mapData.umsSlots : mapInfo.mapData.slots
  }
  let slotsPart: string | undefined
  if (mapInfo && slots !== undefined) {
    if (setup.gameType === GameType.TopVsBottom) {
      slotsPart = t('lobbies.createLobby.teamSplitOption', {
        defaultValue: '{{top}}v{{bottom}}',
        top: setup.gameSubType,
        bottom: slots - setup.gameSubType,
      })
    } else if (isTeamType(setup.gameType)) {
      slotsPart = t('lobbies.createLobby.gameSubTypeOption', {
        defaultValue: '{{numTeams}} teams',
        numTeams: setup.gameSubType,
      })
    } else if (setup.gameType === GameType.OneVsOne) {
      slotsPart = undefined
    } else {
      slotsPart = t('lobbies.hostGame.summarySlots', {
        defaultValue: '{{count}} slots',
        count: slots,
      })
    }
  }

  return [
    visibility === 'listed'
      ? t('lobbies.createLobby.visibilityListed', 'Public')
      : t('lobbies.createLobby.visibilityUnlisted', 'Unlisted'),
    gameTypeToLabel(setup.gameType, t),
    slotsPart,
    mapInfo?.name,
    setup.allowObservers
      ? t('lobbies.hostGame.summaryObserversOn', 'Observers on')
      : t('lobbies.hostGame.summaryObserversOff', 'No observers'),
  ]
    .filter(Boolean)
    .join(' · ')
}
