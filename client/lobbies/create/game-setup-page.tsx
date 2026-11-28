import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameType, gameTypeToLabel, isTeamType } from '../../../common/games/game-type'
import { LobbyVisibility } from '../../../common/lobbies'
import { MapInfoJson, SbMapId } from '../../../common/maps'
import { BrowseLocalMaps } from '../../maps/browse-local-maps'
import { BrowseServerMaps } from '../../maps/browse-server-maps'
import { TextButton } from '../../material/button'
import { SetupPage, SetupPageTitle } from '../setup-page'
import { GameSetupModel } from './game-setup-form'

export enum MapBrowseState {
  None,
  Server,
  Local,
}

const BrowseColumn = styled.div`
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;

  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
`

const BrowseHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  padding: 16px 24px 0;
`

const BrowseArea = styled.div`
  flex-grow: 1;
  min-height: 0;
`

export interface GameSetupPageProps {
  title: string
  /** When set, a back arrow is shown next to the title. */
  onBack?: () => void
  browseState: MapBrowseState
  onBrowseStateChange: (state: MapBrowseState) => void
  /** Called with a map picked in the server browser or uploaded from disk. */
  onMapPicked: (mapId: SbMapId) => void
  /** One-line description of the current setup, shown in the footer bar. */
  summary: string
  /** Action button(s) for the footer bar. */
  footerActions: React.ReactNode
  children: React.ReactNode
}

/**
 * The page every surface that hosts `GameSetupForm` is built on: the lobby setup page scaffold,
 * plus an in-page map browser that swaps in over the form when picking a map.
 */
export function GameSetupPage({
  title,
  onBack,
  browseState,
  onBrowseStateChange,
  onMapPicked,
  summary,
  footerActions,
  children,
}: GameSetupPageProps) {
  const { t } = useTranslation()
  const browsing = browseState !== MapBrowseState.None

  return (
    <SetupPage
      title={title}
      onBack={onBack}
      summary={summary}
      footerActions={footerActions}
      cover={
        browsing ? (
          <BrowseColumn>
            <BrowseHeader>
              <TextButton
                label={t('common.actions.back', 'Back')}
                iconStart='arrow_back'
                onClick={() =>
                  onBrowseStateChange(
                    browseState === MapBrowseState.Local
                      ? MapBrowseState.Server
                      : MapBrowseState.None,
                  )
                }
              />
              <SetupPageTitle>{t('lobbies.createLobby.selectMap', 'Select map')}</SetupPageTitle>
            </BrowseHeader>
            <BrowseArea>
              {browseState === MapBrowseState.Server ? (
                <BrowseServerMaps
                  onMapClick={onMapPicked}
                  onBrowseLocalMaps={() => onBrowseStateChange(MapBrowseState.Local)}
                />
              ) : (
                <BrowseLocalMaps onMapUpload={onMapPicked} />
              )}
            </BrowseArea>
          </BrowseColumn>
        ) : undefined
      }>
      {children}
    </SetupPage>
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
