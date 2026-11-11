import { useId, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  ALL_GAME_TYPES,
  GameType,
  gameTypeAllowsAllianceChanges,
  gameTypeToDescription,
  gameTypeToLabel,
  isTeamType,
} from '../../../common/games/game-type'
import { adjustedGameSubType, MAX_OBSERVERS } from '../../../common/lobbies'
import { SbMapId } from '../../../common/maps'
import { useForm, useFormCallbacks, Validator } from '../../forms/form-hook'
import { CheckBox } from '../../material/check-box'
import { FilterChip } from '../../material/filter-chip'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodySmall } from '../../styles/typography'
import { warpFieldDescription, WarpFieldFixesInfo } from '../warp-field'
import { MapSelectionPanel, Section, SectionHeader } from './map-column'
import { SlotsPreview } from './slots-preview'
import { TeamSplitPicker } from './team-split-picker'

export { Section, SectionHeader } from './map-column'

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

const AdvancedOption = styled.div`
  display: flex;
  flex-direction: column;
`

const AdvancedOptionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

/** Lines up with the text of the checkbox label above it, past the box and its spacing. */
const AdvancedOptionCaption = styled.div`
  ${bodySmall};
  margin-top: -4px;
  padding-left: 30px;
  color: var(--theme-on-surface-variant);
`

export interface GameSetupModel {
  mapId?: SbMapId
  gameType: GameType
  gameSubType: number
  useLegacyLimits: boolean
  starcraftCompatibleReplays: boolean
  lockedAlliances: boolean
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
  /** Host-page-owned content rendered in the map column, below the selected map. */
  mapQueueSection?: React.ReactNode
  /** Maps to offer as one-click picks below the map card, in display order. */
  recentMaps?: ReadonlyArray<SbMapId>
  ref?: React.Ref<GameSetupFormHandle>
}

/**
 * The shared core of the map/game-type/teams/observers/unit-limit fields used both when creating a
 * lobby and when a host is changing an existing one's settings. Owns its own form state (seeded
 * from `model` at mount) and reports validated changes and submissions through the callback props.
 * The settings column can also host caller-owned content (`nameSection`, `visibilitySection`)
 * alongside its own fields, and the map column can offer `recentMaps` as one-click picks below any
 * caller-owned `mapQueueSection`.
 */
export function GameSetupForm({
  disabled,
  model,
  onValidatedChange,
  onSubmit,
  onChangeMap,
  nameSection,
  visibilitySection,
  mapQueueSection,
  recentMaps,
  ref,
}: GameSetupFormProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const warpFieldCaptionId = useId()
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
              {gameTypeAllowsAllianceChanges(gameType) ? (
                <CheckBox
                  {...bindCheckable('lockedAlliances')}
                  label={t('lobbies.createLobby.lockedAlliances', 'Lock alliances')}
                  disabled={disabled}
                  inputProps={{ tabIndex: 0 }}
                />
              ) : null}
            </OptionsRow>
          </Section>

          <Section>
            <SectionHeader>{t('lobbies.createLobby.advancedHeader', 'Advanced')}</SectionHeader>
            <AdvancedOption>
              <AdvancedOptionRow>
                <CheckBox
                  name='warpField'
                  checked={!getInputValue('starcraftCompatibleReplays')}
                  onChange={event =>
                    setInputValue('starcraftCompatibleReplays', !event.target.checked)
                  }
                  label={t('lobbies.createLobby.useWarpField', 'Use Warp Field')}
                  disabled={disabled}
                  inputProps={{
                    tabIndex: 0,
                    'aria-describedby': warpFieldCaptionId,
                  }}
                />
                <WarpFieldFixesInfo />
              </AdvancedOptionRow>
              <AdvancedOptionCaption id={warpFieldCaptionId}>
                {warpFieldDescription(t)}
              </AdvancedOptionCaption>
            </AdvancedOption>
          </Section>
        </SettingsColumn>

        <MapColumn>
          <MapSelectionPanel
            mapId={mapId}
            recentMaps={recentMaps}
            disabled={disabled}
            errorText={mapIdError}
            hasMapPoolChips={true}
            belowMapContent={mapQueueSection}
            onChangeMap={onChangeMap}
            onSelectMap={changeMap}
          />
        </MapColumn>
      </Columns>
    </Form>
  )
}
