import { useEffect, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
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
import { labelLarge, labelSmall } from '../../styles/typography'
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
  display: flex;
  flex-direction: column;
  gap: 32px;
`

const MapGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
`

const MapThumbnailWrapper = styled.div<{ $selected?: boolean }>`
  width: 100%;
  aspect-ratio: 1;

  ${props =>
    props.$selected
      ? css`
          outline: 2px solid var(--theme-amber);
          outline-offset: 2px;
        `
      : ''}
`

const StyledSelectedIcon = styledWithAttrs(MaterialIcon, { icon: 'check_circle', size: 64 })`
  text-shadow: 0 0 8px #000;
`

const BrowseMapsTile = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;

  border: 1px dashed var(--theme-outline);
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }
`

const BrowseMapsIcon = styledWithAttrs(MaterialIcon, { icon: 'search', size: 40 })`
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
  /** Candidate maps for the recent-map tile grid, most recent first. */
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

  // The tiles keep the order `recentMapIds` was passed in, so selecting one highlights it in
  // place instead of reshuffling the grid; the recency reorder only shows up on the next visit,
  // once a lobby has actually been created with the map. Ids from outside the list (the form's
  // starting map, or one picked via the browse dialog) are appended at the end, evicting from the
  // tail to keep the grid at five map tiles.
  const extraMapIds = Array.from(
    new Set([model.mapId, mapId].filter((id): id is SbMapId => !!id && !recentMapIds.includes(id))),
  )
  const mapOptionIds = [...recentMapIds.slice(0, 5 - extraMapIds.length), ...extraMapIds]

  const openMapBrowseDialog = () => {
    dispatch(
      openDialog({
        type: DialogType.SelectMap,
        initData: {
          onSelectMap: (id: SbMapId) => setInputValue('mapId', id),
        },
      }),
    )
  }

  return (
    <Form noValidate={true} onSubmit={submit}>
      <Section>
        <SectionHeader>{t('lobbies.createLobby.selectMap', 'Select map')}</SectionHeader>
        <MapGrid>
          {mapOptionIds.map(id => {
            const onCardClick = disabled ? undefined : () => setInputValue('mapId', id)

            return (
              <MapThumbnailWrapper key={id} $selected={id === mapId}>
                <ReduxMapThumbnail
                  mapId={id}
                  forceAspectRatio={1}
                  size={512}
                  showInfoLayer={true}
                  isSelected={id === mapId}
                  selectedIcon={<StyledSelectedIcon />}
                  onClick={onCardClick}
                />
              </MapThumbnailWrapper>
            )
          })}
          <BrowseMapsTile onClick={disabled ? undefined : openMapBrowseDialog}>
            <BrowseMapsIcon />
            <BrowseMapsText>{t('maps.mapSelect.browseMaps', 'Browse maps')}</BrowseMapsText>
          </BrowseMapsTile>
        </MapGrid>
        {mapIdError ? <InputError error={mapIdError} /> : null}
      </Section>

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
      </Section>

      {isTeamType(gameType) && selectedMapInfo ? (
        <Section>
          <SectionHeader>{t('lobbies.createLobby.gameSubTypeHeader', 'Teams')}</SectionHeader>
          <TeamSplitPicker
            gameType={gameType}
            slots={selectedMapInfo.mapData.slots}
            value={getInputValue('gameSubType')}
            onChange={value => setInputValue('gameSubType', value)}
            disabled={disabled}
          />
        </Section>
      ) : null}

      <Section>
        <div>
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
        </div>
      </Section>
    </Form>
  )
}
