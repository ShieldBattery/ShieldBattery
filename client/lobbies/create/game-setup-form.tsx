import { useEffect, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  ALL_GAME_TYPES,
  GameType,
  gameTypeToDescription,
  gameTypeToLabel,
  isTeamType,
} from '../../../common/games/game-type'
import { MAX_OBSERVERS } from '../../../common/lobbies'
import { SbMapId, tilesetToName } from '../../../common/maps'
import { useForm, useFormCallbacks, Validator } from '../../forms/form-hook'
import { MaterialIcon } from '../../icons/material/material-icon'
import { ReduxMapThumbnail } from '../../maps/map-thumbnail'
import { OutlinedButton } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { CheckBox } from '../../material/check-box'
import { FilterChip } from '../../material/filter-chip'
import { InputError } from '../../material/input-error'
import { useAppSelector } from '../../redux-hooks'
import { bodyLarge, bodySmall, labelLarge, singleLine } from '../../styles/typography'
import { SlotsPreview } from './slots-preview'
import { TeamSplitPicker } from './team-split-picker'

export const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

export const SectionHeader = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

const Form = styled.form`
  container-type: inline-size;
`

/**
 * Splits the form into the settings fields on the left and a map showcase/recent-maps column on
 * the right. A container query (rather than a media query) drives the split so the same form lays
 * out correctly whether it's rendered in the wide "Host a game" page or the narrower in-lobby
 * settings dialog; below the breakpoint, the map column moves above the settings so a map is the
 * first thing visible.
 */
const Columns = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;

  @container (min-width: 720px) {
    flex-direction: row;
    gap: 24px;
    align-items: flex-start;
  }
`

const MapColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  order: -1;

  @container (min-width: 720px) {
    order: 0;
    width: 300px;
    flex-shrink: 0;
  }
`

const SettingsColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 28px;
  flex-grow: 1;
  min-width: 0;
`

/**
 * Arranges the map thumbnail alongside its name and meta line. Narrow containers lay these out as
 * a single compact row; wide containers turn the whole thing into a card, stacking the full-width
 * thumbnail (whose own name bar takes over what the row would otherwise show inline) above the
 * meta line and the change-map button.
 */
const MapPanel = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;

  @container (min-width: 720px) {
    flex-direction: column;
    align-items: stretch;
    gap: 0;

    background-color: var(--theme-container-low);
    border-radius: 8px;
    overflow: hidden;
  }
`

const MapThumbnailWrapper = styled.div`
  width: 96px;
  height: 96px;
  aspect-ratio: 1;
  flex-shrink: 0;

  @container (min-width: 720px) {
    width: 100%;
    height: auto;
  }
`

const MapInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-grow: 1;
  min-width: 0;

  @container (min-width: 720px) {
    padding: 10px 12px 0;
  }
`

const MapName = styled.div`
  ${bodyLarge};
  ${singleLine};

  @container (min-width: 720px) {
    display: none;
  }
`

const MapMeta = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const ChangeMapButton = styled(OutlinedButton)`
  flex-shrink: 0;

  @container (min-width: 720px) {
    align-self: stretch;

    /* Inside the map card, inset the button to sit within the card's padded footer area. */
    ${MapPanel} > & {
      margin: 12px;
    }
  }
`

const EmptyMapPlaceholder = styled.button`
  ${buttonReset};

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;

  width: 96px;
  height: 96px;
  aspect-ratio: 1;
  flex-shrink: 0;

  border: 1px dashed var(--theme-outline);
  border-radius: 4px;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:disabled {
    cursor: default;
    opacity: var(--theme-disabled-opacity);
    pointer-events: none;
  }

  @container (min-width: 720px) {
    width: 100%;
    height: auto;
  }
`

const EmptyMapIcon = styled(MaterialIcon)`
  color: var(--theme-on-surface-variant);
`

const EmptyMapText = styled.div`
  ${labelLarge};
`

const RecentMapsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
`

const RecentMapWrapper = styled.div<{ $selected: boolean }>`
  aspect-ratio: 1;
  padding: 1px;
  border-radius: 6px;
  border: 2px solid ${props => (props.$selected ? 'var(--theme-amber)' : 'transparent')};
`

const GameTypeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const GameTypeDescription = styled.div`
  ${bodySmall};
  min-height: 16px;
  color: var(--theme-on-surface-variant);
`

const OptionsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 24px;
`

export interface GameSetupModel {
  mapId?: SbMapId
  gameType: GameType
  gameSubType: number
  useLegacyLimits: boolean
  allowObservers: boolean
}

export interface GameSetupFormHandle {
  submit(): void
  setMap(mapId: SbMapId): void
}

const mapIdValidator: Validator<SbMapId | undefined, GameSetupModel> = (
  value,
  _model,
  _dirty,
  t,
) => {
  if (!value) {
    return t('lobbies.createLobby.mapRequired', 'Select a map to play')
  }

  return undefined
}

function RecentMapEntry({
  mapId,
  selected,
  disabled,
  onClick,
}: {
  mapId: SbMapId
  selected: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const mapName = useAppSelector(s => s.maps.byId.get(mapId)?.name)

  return (
    <RecentMapWrapper $selected={selected} title={mapName}>
      <ReduxMapThumbnail
        mapId={mapId}
        size={256}
        forceAspectRatio={1}
        hasMapDetailsAction={false}
        hasDownloadAction={false}
        hasFavoriteAction={false}
        hasMapPreviewAction={false}
        hasRegenMapImageAction={false}
        onClick={disabled ? undefined : onClick}
      />
    </RecentMapWrapper>
  )
}

export interface GameSetupFormProps {
  disabled?: boolean
  /** The form's starting values; only read once, when the form mounts. */
  model: GameSetupModel
  onValidatedChange?: (model: ReadonlyDeep<GameSetupModel>) => void
  onSubmit: (model: ReadonlyDeep<GameSetupModel>) => void
  /**
   * Called when the user asks to pick a different map. The host surface decides how the map
   * browser is shown; it delivers the result back through the form handle's `setMap`.
   */
  onChangeMap: () => void
  /** Host-page-owned content rendered at the top of the settings column, e.g. a lobby name field. */
  nameSection?: React.ReactNode
  /** Host-page-owned content rendered between the Slots and Options sections. */
  visibilitySection?: React.ReactNode
  /** Maps to offer as one-click picks below the map card, in display order. */
  recentMaps?: ReadonlyArray<SbMapId>
  ref?: React.Ref<GameSetupFormHandle>
}

/**
 * The shared core of the map/game-type/teams/observers/unit-limit fields used both when creating a
 * lobby and when a host is changing an existing one's settings. Owns its own form state (seeded
 * from `model` at mount) and reports validated changes and submissions through the callback props.
 * The settings column can also host caller-owned content (`nameSection`, `visibilitySection`)
 * alongside its own fields, and the map column can offer `recentMaps` as one-click picks.
 */
export function GameSetupForm({
  disabled,
  model,
  onValidatedChange,
  onSubmit,
  onChangeMap,
  nameSection,
  visibilitySection,
  recentMaps,
  ref,
}: GameSetupFormProps) {
  const { t } = useTranslation()
  const { bindCheckable, bindCustom, getInputValue, setInputValue, form, submit } =
    useForm<GameSetupModel>(model, {
      mapId: mapIdValidator,
    })

  useFormCallbacks(form, {
    onValidatedChange,
    onSubmit,
  })

  useImperativeHandle(ref, () => ({
    submit,
    setMap: (mapId: SbMapId) => setInputValue('mapId', mapId),
  }))

  const mapId = getInputValue('mapId')
  const mapIdError = bindCustom('mapId').errorText
  const gameType = getInputValue('gameType')
  const selectedMapInfo = useAppSelector(s => (mapId ? s.maps.byId.get(mapId) : undefined))

  useEffect(() => {
    if (!selectedMapInfo || !isTeamType(gameType)) {
      return
    }

    const subType = getInputValue('gameSubType')
    const {
      mapData: { slots },
    } = selectedMapInfo

    // Ensure that the game sub-type is always valid for the selected map. The lower bound matters
    // when the form's starting game type has no sub-type at all (its value is 0), which every team
    // type's options start above; with no prior split to preserve, the most balanced one is the
    // natural starting point.
    if (gameType === GameType.TopVsBottom) {
      const maxTopSlots = slots - 1
      if (subType > maxTopSlots) {
        setInputValue('gameSubType', maxTopSlots)
      } else if (subType < 1) {
        setInputValue('gameSubType', Math.floor(slots / 2))
      }
    } else {
      const maxTeams = Math.min(4, slots)
      if (subType < 2 || subType > maxTeams) {
        setInputValue('gameSubType', Math.min(maxTeams, Math.max(2, subType)))
      }
    }
  }, [gameType, selectedMapInfo, getInputValue, setInputValue])

  const mapMetaParts = selectedMapInfo
    ? [
        t('lobbies.createLobby.mapPlayerCount', {
          defaultValue: '{{count}} players',
          // eslint-disable-next-line camelcase -- i18next's plural-form key convention
          defaultValue_one: '{{count}} player',
          count: selectedMapInfo.mapData.slots,
        }),
        tilesetToName(selectedMapInfo.mapData.tileset, t),
        `${selectedMapInfo.mapData.width}×${selectedMapInfo.mapData.height}`,
      ]
    : []

  return (
    <Form noValidate={true} onSubmit={submit}>
      <Columns>
        <SettingsColumn>
          {nameSection}

          <Section>
            <SectionHeader>{t('lobbies.createLobby.gameTypeHeader', 'Game type')}</SectionHeader>
            <GameTypeRow>
              {ALL_GAME_TYPES.map(type => (
                <FilterChip
                  key={type}
                  label={gameTypeToLabel(type, t)}
                  selected={type === gameType}
                  checkmark={false}
                  disabled={disabled}
                  onClick={() => setInputValue('gameType', type)}
                />
              ))}
            </GameTypeRow>
            <GameTypeDescription>{gameTypeToDescription(gameType, t)}</GameTypeDescription>
          </Section>

          {isTeamType(gameType) && selectedMapInfo ? (
            <Section>
              <SectionHeader>
                {gameType === GameType.TopVsBottom
                  ? t('lobbies.createLobby.teamSplitHeader', 'Team split')
                  : t('lobbies.createLobby.gameSubTypeHeader', 'Teams')}
              </SectionHeader>
              <TeamSplitPicker
                gameType={gameType}
                slots={selectedMapInfo.mapData.slots}
                value={getInputValue('gameSubType')}
                onChange={value => setInputValue('gameSubType', value)}
                disabled={disabled}
              />
            </Section>
          ) : null}

          {selectedMapInfo ? (
            <Section>
              <SectionHeader>{t('lobbies.createLobby.slotsHeader', 'Slots')}</SectionHeader>
              <SlotsPreview
                gameType={gameType}
                gameSubType={getInputValue('gameSubType')}
                slots={
                  gameType === GameType.UseMapSettings
                    ? selectedMapInfo.mapData.umsSlots
                    : selectedMapInfo.mapData.slots
                }
                mapName={selectedMapInfo.name}
              />
            </Section>
          ) : null}

          {visibilitySection}

          <Section>
            <SectionHeader>{t('lobbies.createLobby.optionsHeader', 'Options')}</SectionHeader>
            <OptionsRow>
              <CheckBox
                {...bindCheckable('allowObservers')}
                label={t('lobbies.createLobby.allowObserversWithMax', {
                  defaultValue: 'Allow observers (up to {{maxObservers}})',
                  maxObservers: MAX_OBSERVERS,
                })}
                disabled={disabled}
                inputProps={{ tabIndex: 0 }}
              />
              <CheckBox
                {...bindCheckable('useLegacyLimits')}
                label={t('lobbies.createLobby.useLegacyLimits', 'Use legacy unit limit')}
                disabled={disabled}
                inputProps={{ tabIndex: 0 }}
              />
            </OptionsRow>
          </Section>
        </SettingsColumn>

        <MapColumn>
          {mapId ? (
            <MapPanel>
              <MapThumbnailWrapper>
                <ReduxMapThumbnail
                  mapId={mapId}
                  forceAspectRatio={1}
                  size={512}
                  showInfoLayer={true}
                  onClick={disabled ? undefined : onChangeMap}
                />
              </MapThumbnailWrapper>
              <MapInfo>
                <MapName>{selectedMapInfo?.name ?? ''}</MapName>
                <MapMeta>{mapMetaParts.join(' · ')}</MapMeta>
              </MapInfo>
              <ChangeMapButton
                type='button'
                label={t('lobbies.hostGame.changeMap', 'Change map')}
                iconStart={<MaterialIcon icon='map' />}
                disabled={disabled}
                onClick={onChangeMap}
              />
            </MapPanel>
          ) : (
            <EmptyMapPlaceholder type='button' disabled={disabled} onClick={onChangeMap}>
              <EmptyMapIcon icon='map' />
              <EmptyMapText>{t('lobbies.createLobby.selectMap', 'Select map')}</EmptyMapText>
            </EmptyMapPlaceholder>
          )}
          {mapIdError ? <InputError error={mapIdError} /> : null}

          {recentMaps?.length ? (
            <Section>
              <SectionHeader>
                {t('lobbies.createLobby.recentMapsHeader', 'Recent maps')}
              </SectionHeader>
              <RecentMapsGrid>
                {recentMaps.map(id => (
                  <RecentMapEntry
                    key={id}
                    mapId={id}
                    selected={id === mapId}
                    disabled={disabled}
                    onClick={() => setInputValue('mapId', id)}
                  />
                ))}
              </RecentMapsGrid>
            </Section>
          ) : null}
        </MapColumn>
      </Columns>
    </Form>
  )
}
