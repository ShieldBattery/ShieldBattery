import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameType, gameTypeToLabel, isTeamType } from '../../../common/games/game-type'
import { LobbyVisibility } from '../../../common/lobbies'
import { MapInfoJson, SbMapId } from '../../../common/maps'
import { MaterialIcon } from '../../icons/material/material-icon'
import { BrowseLocalMaps } from '../../maps/browse-local-maps'
import { BrowseServerMaps } from '../../maps/browse-server-maps'
import { IconButton, TextButton } from '../../material/button'
import { bodySmall, singleLine, titleLarge } from '../../styles/typography'
import { GameSetupModel } from './game-setup-form'

export enum MapBrowseState {
  None,
  Server,
  Local,
}

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
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

const HeaderBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const BrowseColumn = styled.div`
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;

  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
`

const BrowseHeader = styled(HeaderBlock)`
  align-items: flex-start;
  padding: 16px 24px 0;
`

const BrowseArea = styled.div`
  flex-grow: 1;
  min-height: 0;
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
 * The page scaffolding shared by every surface that hosts `GameSetupForm`: a title header above the
 * 960px form column, an in-page map browser that swaps in over the form when picking a map, and a
 * footer bar with a one-line summary and the caller's action buttons. The form itself stays mounted
 * (but hidden) while browsing, so in-progress edits survive the round trip.
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
    <Root>
      {browsing ? (
        <BrowseColumn>
          <BrowseHeader>
            <TextButton
              label={t('common.actions.back', 'Back')}
              iconStart={<MaterialIcon icon='arrow_back' />}
              onClick={() =>
                onBrowseStateChange(
                  browseState === MapBrowseState.Local
                    ? MapBrowseState.Server
                    : MapBrowseState.None,
                )
              }
            />
            <Title>{t('lobbies.createLobby.selectMap', 'Select map')}</Title>
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
