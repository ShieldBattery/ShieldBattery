import { useEffect, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  ALL_GAME_TYPES,
  GameType,
  gameTypeToLabel,
  isTeamType,
} from '../../../common/games/game-type'
import { MAX_OBSERVERS } from '../../../common/lobbies'
import { SbMapId } from '../../../common/maps'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { useForm, useFormCallbacks, Validator } from '../../forms/form-hook'
import { MaterialIcon } from '../../icons/material/material-icon'
import { ReduxMapThumbnail } from '../../maps/map-thumbnail'
import { CheckBox } from '../../material/check-box'
import { FilterChip } from '../../material/filter-chip'
import { InputError } from '../../material/input-error'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { styledWithAttrs } from '../../styles/styled-with-attrs'
import { bodyLarge, bodySmall, labelSmall } from '../../styles/typography'
import { TeamSplitPicker } from './team-split-picker'

const SectionHeader = styled.div`
  ${bodyLarge};
  margin: 20px 0 8px;

  &:first-child {
    margin-top: 0;
  }
`

const MapRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const MapTile = styled(ReduxMapThumbnail)`
  width: 120px;
  height: 120px;
  cursor: pointer;
`

const BrowseMapsTile = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 120px;

  border: 1px dashed var(--theme-outline);
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }
`

const BrowseMapsIcon = styledWithAttrs(MaterialIcon, { icon: 'search', size: 32 })`
  color: var(--theme-on-surface-variant);
`

const BrowseMapsText = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  margin-top: 4px;
  text-align: center;
`

const GameTypeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const ObserversSection = styled.div`
  margin-top: 20px;
`

const ObserversHint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  margin: 4px 0 0 30px;
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
  /** Candidate maps for the recent-map tile row, most recent first. */
  recentMapIds: ReadonlyArray<SbMapId>
  onValidatedChange?: (model: ReadonlyDeep<GameSetupModel>) => void
  onSubmit: (model: ReadonlyDeep<GameSetupModel>) => void
  ref?: React.Ref<GameSetupFormHandle>
}

/**
 * The shared core of the map/game-type/teams/observers/unit-limit fields used both when creating a
 * lobby and when a host is changing an existing one's settings. Owns its own form state (seeded
 * from `model` at mount) and reports validated changes and submissions through the callback props.
 */
export function GameSetupForm({
  disabled,
  model,
  recentMapIds,
  onValidatedChange,
  onSubmit,
  ref,
}: GameSetupFormProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { bindCheckable, bindCustom, getInputValue, setInputValue, form, submit } =
    useForm<GameSetupModel>(model, {
      mapId: mapIdValidator,
    })

  useFormCallbacks(form, {
    onValidatedChange,
    onSubmit,
  })

  useImperativeHandle(ref, () => ({ submit }))

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

  // `model.mapId` is included so a map picked via the browse dialog (which may not be in the
  // recent list, or even have been the form's starting map) still shows up as an option.
  const mapOptionIds = Array.from(
    new Set([mapId, model.mapId, ...recentMapIds].filter((id): id is SbMapId => !!id)),
  ).slice(0, 5)

  return (
    <form noValidate={true} onSubmit={submit}>
      <SectionHeader>{t('lobbies.createLobby.selectMap', 'Select map')}</SectionHeader>
      <MapRow>
        {mapOptionIds.map(id => (
          <MapTile
            key={id}
            mapId={id}
            forceAspectRatio={1}
            size={256}
            showInfoLayer={true}
            isSelected={id === mapId}
            onClick={disabled ? undefined : () => setInputValue('mapId', id)}
          />
        ))}
        <BrowseMapsTile
          onClick={
            disabled
              ? undefined
              : () => {
                  dispatch(
                    openDialog({
                      type: DialogType.SelectMap,
                      initData: {
                        onSelectMap: (id: SbMapId) => setInputValue('mapId', id),
                      },
                    }),
                  )
                }
          }>
          <BrowseMapsIcon />
          <BrowseMapsText>{t('maps.mapSelect.browseMaps', 'Browse maps')}</BrowseMapsText>
        </BrowseMapsTile>
      </MapRow>
      <InputError error={mapIdError} />

      <SectionHeader>{t('lobbies.createLobby.gameTypeHeader', 'Game type')}</SectionHeader>
      <GameTypeRow>
        {ALL_GAME_TYPES.map(type => (
          <FilterChip
            key={type}
            label={gameTypeToLabel(type, t)}
            selected={type === gameType}
            disabled={disabled}
            onClick={() => setInputValue('gameType', type)}
          />
        ))}
      </GameTypeRow>

      {isTeamType(gameType) && selectedMapInfo ? (
        <>
          <SectionHeader>{t('lobbies.createLobby.gameSubTypeHeader', 'Teams')}</SectionHeader>
          <TeamSplitPicker
            gameType={gameType}
            slots={selectedMapInfo.mapData.slots}
            value={getInputValue('gameSubType')}
            onChange={value => setInputValue('gameSubType', value)}
            disabled={disabled}
          />
        </>
      ) : null}

      <ObserversSection>
        <CheckBox
          {...bindCheckable('allowObservers')}
          label={t('lobbies.createLobby.allowObservers', 'Allow observers')}
          disabled={disabled}
          inputProps={{ tabIndex: 0 }}
        />
      </ObserversSection>
      <ObserversHint>
        {t('lobbies.hostGame.allowObserversDescription', {
          defaultValue: 'Up to {{maxObservers}} observer seats in any game type',
          maxObservers: MAX_OBSERVERS,
        })}
      </ObserversHint>

      <SectionHeader>
        {t('lobbies.createLobby.advancedSettings', 'Advanced settings')}
      </SectionHeader>
      <CheckBox
        {...bindCheckable('useLegacyLimits')}
        label={t('lobbies.createLobby.useLegacyLimits', 'Use legacy unit limit')}
        disabled={disabled}
        inputProps={{ tabIndex: 0 }}
      />
    </form>
  )
}
