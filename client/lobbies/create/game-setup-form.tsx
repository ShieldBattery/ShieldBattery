import { useImperativeHandle } from 'react'
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
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
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

/**
 * Returns `subType` adjusted to be valid for a team-based `gameType` on a map with `slots` player
 * slots. The lower bound matters when the sub-type has never been set for a team type (its value
 * is 0, below every team type's options); with no prior split to preserve, the most balanced one
 * is the natural starting point.
 *
 * For top-vs-bottom, `prevSlots` is the slot count the sub-type was valid for before the change
 * being applied: a sub-type that was the balanced split for it carries over as "balanced" rather
 * than as a literal seat count (4v4 on 8 slots becomes 2v2 on 4 slots), while a deliberately
 * lopsided split preserves its top team size, clamped to the new map.
 */
function adjustedGameSubType({
  gameType,
  subType,
  prevSlots,
  slots,
}: {
  gameType: GameType
  subType: number
  prevSlots?: number
  slots: number
}): number {
  if (gameType === GameType.TopVsBottom) {
    const balanced = Math.floor(slots / 2)
    if (subType < 1) {
      return balanced
    }
    if (prevSlots !== undefined && subType === Math.floor(prevSlots / 2)) {
      return balanced
    }
    return Math.min(subType, slots - 1)
  } else {
    const maxTeams = Math.min(4, slots)
    return Math.min(maxTeams, Math.max(2, subType))
  }
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
  const dispatch = useAppDispatch()
  // The model prop is only read at mount, so this only affects the initial form seeding: a saved
  // sub-type may be unset (0) or stale relative to the saved map, and is normalized against that
  // map before the form ever holds it. Afterwards the map/game-type change handlers below keep the
  // sub-type valid, adjusting it in the same event that changes what it must be valid for.
  const initialMapInfo = useAppSelector(s =>
    model.mapId ? s.maps.byId.get(model.mapId) : undefined,
  )
  const { bindCheckable, bindCustom, getInputValue, setInputValue, form, submit } =
    useForm<GameSetupModel>(
      initialMapInfo && isTeamType(model.gameType)
        ? {
            ...model,
            gameSubType: adjustedGameSubType({
              gameType: model.gameType,
              subType: model.gameSubType,
              slots: initialMapInfo.mapData.slots,
            }),
          }
        : model,
      {
        mapId: mapIdValidator,
      },
    )

  useFormCallbacks(form, {
    onValidatedChange,
    onSubmit,
  })

  const mapId = getInputValue('mapId')
  const mapIdError = bindCustom('mapId').errorText
  const gameType = getInputValue('gameType')
  const selectedMapInfo = useAppSelector(s => (mapId ? s.maps.byId.get(mapId) : undefined))

  const changeMap = (newMapId: SbMapId) => {
    if (isTeamType(gameType)) {
      // Every path that delivers a pickable map (recent maps, the server browser, local uploads)
      // has already put its info in the store, so the new slot count is available in the same
      // event that changes the map and the sub-type never exists in an invalid state. The thunk
      // runs synchronously; it exists just to read the new map's info from the store.
      dispatch((_dispatch, getState) => {
        const newMapInfo = getState().maps.byId.get(newMapId)
        if (newMapInfo) {
          const subType = getInputValue('gameSubType')
          const adjusted = adjustedGameSubType({
            gameType,
            subType,
            prevSlots: selectedMapInfo?.mapData.slots,
            slots: newMapInfo.mapData.slots,
          })
          if (adjusted !== subType) {
            setInputValue('gameSubType', adjusted)
          }
        }
      })
    }
    setInputValue('mapId', newMapId)
  }

  const changeGameType = (newGameType: GameType) => {
    if (isTeamType(newGameType) && selectedMapInfo) {
      const subType = getInputValue('gameSubType')
      const {
        mapData: { slots },
      } = selectedMapInfo
      // Sub-types only share meaning within a kind: a seat count for top vs bottom, a team count
      // for team melee/FFA. A sub-type carried across kinds (or in from a non-team type) has no
      // meaning to preserve, so it's treated as never set and takes the new type's default.
      const sameSubTypeKind =
        isTeamType(gameType) &&
        (gameType === GameType.TopVsBottom) === (newGameType === GameType.TopVsBottom)
      const adjusted = adjustedGameSubType({
        gameType: newGameType,
        subType: sameSubTypeKind ? subType : 0,
        prevSlots: slots,
        slots,
      })
      if (adjusted !== subType) {
        setInputValue('gameSubType', adjusted)
      }
    }
    setInputValue('gameType', newGameType)
  }

  useImperativeHandle(ref, () => ({
    submit,
    setMap: changeMap,
  }))

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
                  onClick={() => changeGameType(type)}
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
                    onClick={() => changeMap(id)}
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
