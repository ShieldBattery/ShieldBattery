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
import { buttonReset } from '../../material/button-reset'
import { CheckBox } from '../../material/check-box'
import { FilterChip } from '../../material/filter-chip'
import { InputError } from '../../material/input-error'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodyLarge, bodySmall, labelLarge, singleLine } from '../../styles/typography'
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

const MapCard = styled.button<{ $hasMap: boolean }>`
  ${buttonReset};

  display: flex;
  align-items: center;
  ${props => (props.$hasMap ? '' : 'justify-content: center;')}
  gap: 12px;
  width: 100%;
  max-width: 640px;
  min-height: 120px;
  padding: 12px;
  border-radius: 8px;
  text-align: left;

  border: ${props =>
    props.$hasMap ? '1px solid var(--theme-outline-variant)' : '1px dashed var(--theme-outline)'};

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:disabled {
    cursor: default;
    opacity: var(--theme-disabled-opacity);
    pointer-events: none;
  }
`

const MapCardThumbnail = styled.div`
  width: 96px;
  height: 96px;
  flex-shrink: 0;
`

const MapCardInfo = styled.div`
  flex-grow: 1;
  min-width: 0;
  text-align: left;
`

const MapCardName = styled.div`
  ${bodyLarge};
  ${singleLine};
`

const MapCardMeta = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const ChangeMapLabel = styled.div`
  ${labelLarge};
  color: var(--theme-amber);
  flex-shrink: 0;
`

const EmptyMapIcon = styled(MaterialIcon)`
  color: var(--theme-on-surface-variant);
`

const EmptyMapText = styled.div`
  ${labelLarge};
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
        <SectionHeader>{t('lobbies.createLobby.mapHeader', 'Map')}</SectionHeader>
        <MapCard type='button' disabled={disabled} $hasMap={!!mapId} onClick={openMapBrowseDialog}>
          {mapId ? (
            <>
              <MapCardThumbnail>
                {/* Purely decorative: the surrounding card is the click target, and rendering the
                    thumbnail's own action buttons would nest buttons inside it. */}
                <ReduxMapThumbnail
                  mapId={mapId}
                  forceAspectRatio={1}
                  size={256}
                  hasFavoriteAction={false}
                  hasMapPreviewAction={false}
                />
              </MapCardThumbnail>
              <MapCardInfo>
                <MapCardName>{selectedMapInfo?.name ?? ''}</MapCardName>
                <MapCardMeta>
                  {selectedMapInfo
                    ? t('lobbies.createLobby.mapPlayerCount', {
                        defaultValue: '{{count}} players',
                        // eslint-disable-next-line camelcase -- i18next's plural-form key convention
                        defaultValue_one: '{{count}} player',
                        count: selectedMapInfo.mapData.slots,
                      })
                    : ''}
                </MapCardMeta>
              </MapCardInfo>
              <ChangeMapLabel>{t('lobbies.hostGame.changeMap', 'Change map')}</ChangeMapLabel>
            </>
          ) : (
            <>
              <EmptyMapIcon icon='map' />
              <EmptyMapText>{t('lobbies.createLobby.selectMap', 'Select map')}</EmptyMapText>
            </>
          )}
        </MapCard>
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
