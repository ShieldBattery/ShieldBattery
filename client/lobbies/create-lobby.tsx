import { debounce } from 'lodash-es'
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { useRoute } from 'wouter'
import { LOBBY_NAME_MAXLENGTH, LOBBY_NAME_PATTERN } from '../../common/constants'
import {
  ALL_GAME_TYPES,
  GameType,
  gameTypeToLabel,
  isTeamType,
} from '../../common/games/configuration'
import { MapInfoJson } from '../../common/maps'
import { ALL_TURN_RATES, BwTurnRate } from '../../common/network'
import { range } from '../../common/range'
import { useForm, Validator } from '../forms/form-hook'
import { SubmitOnEnter } from '../forms/submit-on-enter'
import { composeValidators, maxLength, regex, required } from '../forms/validators'
import { MaterialIcon } from '../icons/material/material-icon'
import { BrowseLocalMaps } from '../maps/browse-local-maps'
import { BrowseServerMaps } from '../maps/browse-server-maps'
import { MapSelect, MapSelectionValue } from '../maps/map-select'
import { useAutoFocusRef } from '../material/auto-focus'
import { RaisedButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { bodyLarge, titleLarge } from '../styles/typography'
import {
  createLobby,
  getLobbyPreferences,
  navigateToLobby,
  updateLobbyPreferences,
} from './action-creators'

// TODO(tec27): Move to common and use on the server as well
const NUM_RECENT_MAPS = 5

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const TitleBar = styled.div`
  position: relative;
  padding: 8px 8px 16px;
`

const Title = styled.div`
  ${titleLarge};
  padding: 8px 16px 0;
`

const Contents = styled.div<{ $disabled: boolean; $hidden: boolean }>`
  position: relative;
  flex-grow: 1;

  display: ${props => (props.$hidden ? 'none' : 'block')};

  contain: strict;
  overflow-y: ${props => (props.$disabled ? 'hidden' : 'auto')};
`

const ContentsBody = styled.div`
  padding: 12px 24px;
`

const Actions = styled.div<{ $hidden: boolean }>`
  position: relative;
  display: ${props => (props.$hidden ? 'none' : 'block')};
  padding: 16px 24px;
`

const GameTypeAndSubType = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;

  & > * {
    width: calc(50% - 10px);
  }
`

const AdvancedSettings = styled.div`
  max-width: 320px;
  margin-top: 32px;
`

const SectionHeader = styled.div`
  ${bodyLarge};
  margin: 16px 0;
`

interface CreateLobbyModel {
  name: string
  mapSelection: MapSelectionValue
  gameType: GameType
  gameSubType: number
  turnRate: BwTurnRate | 0 | null
  useLegacyLimits: boolean
}

const lobbyNameValidator = composeValidators(
  required(t => t('lobbies.createLobby.lobbyNameRequired', 'Enter a lobby name')),
  maxLength(LOBBY_NAME_MAXLENGTH),
  regex(LOBBY_NAME_PATTERN, t =>
    t('lobbies.createLobby.lobbyNameInvalidCharacters', 'Lobby name contains invalid characters'),
  ),
)
const mapSelectionValidator: Validator<MapSelectionValue, CreateLobbyModel> = (
  value,
  _model,
  _dirty,
  t,
) => {
  if (!value || !value.mapId) {
    return t('lobbies.createLobby.mapRequired', 'Select a map to play')
  }

  return undefined
}

interface CreateLobbyFormHandle {
  submit(): void
}

interface CreateLobbyFormProps {
  disabled: boolean
  model: CreateLobbyModel
  onSubmit: (model: CreateLobbyModel) => void
  onValidatedChange: (model: CreateLobbyModel) => void
  onMapBrowse: (onMapSelect: (mapId: string) => void) => void
}

/** Updates the list of recent maps given that `selectedId` is a newly selected map. */
function updateRecentMaps(
  selectedId: string,
  numRecentMaps: number,
  recentMaps: ReadonlyArray<string> = [],
): string[] {
  return [selectedId, ...recentMaps.filter(m => m !== selectedId).slice(0, numRecentMaps - 1)]
}

const TURN_RATE_OPTIONS: ReadonlyArray<BwTurnRate> = ALL_TURN_RATES.slice(0).sort((a, b) => b - a)

const CreateLobbyForm = React.forwardRef<CreateLobbyFormHandle, CreateLobbyFormProps>(
  (props, ref) => {
    const { t } = useTranslation()
    const { onSubmit, bindInput, bindCustom, bindCheckable, getInputValue, setInputValue } =
      useForm(
        props.model,
        { name: lobbyNameValidator, mapSelection: mapSelectionValidator },
        { onSubmit: props.onSubmit, onValidatedChange: props.onValidatedChange },
      )
    const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

    useImperativeHandle(ref, () => ({
      submit: onSubmit,
    }))

    const { disabled, onMapBrowse } = props

    const mapSelection = getInputValue('mapSelection')
    const selectedMap = mapSelection.mapId
    const gameType = getInputValue('gameType')

    const selectedMapInfo = useAppSelector(s => selectedMap && s.maps2.byId.get(selectedMap))

    const onBrowseClick = useStableCallback(() => {
      onMapBrowse(mapId => {
        setInputValue('mapSelection', {
          mapId,
          recentMaps: updateRecentMaps(mapId, NUM_RECENT_MAPS, mapSelection.recentMaps),
        })
      })
    })

    useEffect(() => {
      if (!selectedMapInfo || !isTeamType(gameType)) return

      const subType = getInputValue('gameSubType')
      const {
        mapData: { slots },
      } = selectedMapInfo

      // Ensure that the game sub-type is always valid for the selected map
      if (gameType === 'topVBottom') {
        const maxTopSlots = slots - 1
        if (subType > maxTopSlots) {
          setInputValue('gameSubType', Math.min(maxTopSlots, Math.max(0, subType)))
        }
      } else {
        const maxTeams = Math.min(4, slots)
        if (subType > Math.min(4, slots)) {
          setInputValue('gameSubType', Math.min(maxTeams, Math.max(2, subType)))
        }
      }
    }, [gameType, selectedMapInfo, getInputValue, setInputValue])

    let gameSubTypeSelection: React.ReactNode
    if (!isTeamType(gameType)) {
      gameSubTypeSelection = null
    } else {
      if (!selectedMapInfo) {
        gameSubTypeSelection = null
      } else {
        const {
          mapData: { slots },
        } = selectedMapInfo
        if (gameType === GameType.TopVsBottom) {
          gameSubTypeSelection = (
            <Select
              {...bindCustom('gameSubType')}
              label={t('lobbies.createLobby.gameSubTypeHeader', 'Teams')}
              disabled={disabled}
              tabIndex={0}>
              {Array.from(range(slots - 1, 0), top => (
                <SelectOption
                  key={top}
                  value={top}
                  text={t('lobbies.createLobby.gameSubTypeOptionTvB', {
                    defaultValue: '{{topSlots}} vs {{bottomSlots}}',
                    topSlots: top,
                    bottomSlots: slots - top,
                  })}
                />
              ))}
            </Select>
          )
        } else {
          gameSubTypeSelection = (
            <Select
              {...bindCustom('gameSubType')}
              label={t('lobbies.createLobby.gameSubTypeHeader', 'Teams')}
              disabled={disabled}
              tabIndex={0}>
              {Array.from(range(2, Math.min(slots, 4) + 1), numTeams => (
                <SelectOption
                  key={numTeams}
                  value={numTeams}
                  text={t('lobbies.createLobby.gameSubTypeOption', {
                    defaultValue: '{{numTeams}} teams',
                    numTeams,
                  })}
                />
              ))}
            </Select>
          )
        }
      }
    }

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <TextField
          {...bindInput('name')}
          ref={autoFocusRef}
          label={t('lobbies.createLobby.lobbyName', 'Lobby name')}
          disabled={disabled}
          floatingLabel={true}
          inputProps={{
            autoCapitalize: 'off',
            autoComplete: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            tabIndex: 0,
          }}
        />
        <GameTypeAndSubType>
          <Select
            {...bindCustom('gameType')}
            label={t('lobbies.createLobby.gameTypeHeader', 'Game type')}
            disabled={disabled}
            tabIndex={0}>
            {ALL_GAME_TYPES.map(type => (
              <SelectOption key={type} value={type} text={gameTypeToLabel(type, t)} />
            ))}
          </Select>
          {gameSubTypeSelection}
        </GameTypeAndSubType>

        <SectionHeader>{t('lobbies.createLobby.selectMap', 'Select map')}</SectionHeader>
        <MapSelect
          {...bindCustom('mapSelection')}
          disabled={disabled}
          onMapBrowse={onBrowseClick}
          numRecentMaps={NUM_RECENT_MAPS}
        />

        <AdvancedSettings>
          <SectionHeader>
            {t('lobbies.createLobby.advancedSettings', 'Advanced settings')}
          </SectionHeader>
          <Select
            {...bindCustom('turnRate')}
            label={t('lobbies.createLobby.turnRate', 'Turn rate')}
            disabled={disabled}
            tabIndex={0}>
            <SelectOption
              key='auto'
              value={null}
              text={t('lobbies.createLobby.turnRateAuto', 'Auto')}
            />
            {TURN_RATE_OPTIONS.map(t => (
              <SelectOption key={t} value={t} text={String(t)} />
            ))}
            <SelectOption
              key='dtr'
              value={0}
              text={t('lobbies.createLobby.turnRateDynamic', 'DTR (Not recommended)')}
            />
          </Select>
          <CheckBox
            {...bindCheckable('useLegacyLimits')}
            label={t('lobbies.createLobby.useLegacyLimits', 'Use legacy unit limit')}
            disabled={disabled}
            inputProps={{ tabIndex: 0 }}
          />
        </AdvancedSettings>
      </form>
    )
  },
)

export interface CreateLobbyProps {
  onNavigateToList: () => void
}

enum MapBrowseState {
  None,
  Server,
  Local,
}

export function CreateLobby(props: CreateLobbyProps) {
  const [routeMatches, routeParams] = useRoute('/play/lobbies/create/:name?')
  const routeName =
    routeMatches && routeParams.name ? decodeURIComponent(routeParams.name) : undefined

  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const isRequesting = useAppSelector(s => s.lobbyPreferences.isRequesting)
  const hasLoaded = useAppSelector(s => s.lobbyPreferences.hasLoaded)
  const prefsName = useAppSelector(s => s.lobbyPreferences.name)
  const gameType = useAppSelector(s => s.lobbyPreferences.gameType)
  const gameSubType = useAppSelector(s => s.lobbyPreferences.gameSubType)
  const turnRate = useAppSelector(s => s.lobbyPreferences.turnRate)
  const useLegacyLimits = useAppSelector(s => s.lobbyPreferences.useLegacyLimits)

  const storeSelectedMap = useAppSelector(s => s.lobbyPreferences.selectedMap)
  const storeRecentMaps = useAppSelector(s => s.lobbyPreferences.recentMaps)

  const initialName = routeName ?? prefsName ?? ''

  const model = useMemo(
    () =>
      ({
        name: initialName,
        gameType: gameType ?? 'melee',
        gameSubType,
        mapSelection: {
          mapId: storeSelectedMap,
          recentMaps: storeRecentMaps.toArray(),
        },
        turnRate: turnRate ?? null,
        useLegacyLimits: useLegacyLimits ?? false,
      }) satisfies CreateLobbyModel,
    [
      initialName,
      gameType,
      gameSubType,
      storeSelectedMap,
      storeRecentMaps,
      turnRate,
      useLegacyLimits,
    ],
  )

  const formRef = useRef<CreateLobbyFormHandle>(null)
  const [isAtTop, isAtBottom, topElem, bottomElem] = useScrollIndicatorState()

  const [browsingMaps, setBrowsingMaps] = useState(MapBrowseState.None)
  const mapSelectCallbackRef = useRef<(mapId: string) => void>()

  const onCreateClick = useStableCallback(() => {
    formRef.current?.submit()
  })
  const onMapBrowse = useStableCallback((mapSelectCallback: (mapId: string) => void) => {
    mapSelectCallbackRef.current = mapSelectCallback
    setBrowsingMaps(MapBrowseState.Server)
  })
  const onBrowseLocalMaps = useStableCallback(() => {
    setBrowsingMaps(MapBrowseState.Local)
  })
  const onMapSelect = useStableCallback((map: ReadonlyDeep<MapInfoJson>) => {
    mapSelectCallbackRef.current?.(map.id)
    mapSelectCallbackRef.current = undefined
    setBrowsingMaps(MapBrowseState.None)
  })

  const debouncedSavePrefrencesRef = useRef(
    debounce((model: CreateLobbyModel) => {
      dispatch(
        updateLobbyPreferences({
          name: model.name,
          selectedMap: model.mapSelection.mapId,
          recentMaps: model.mapSelection.recentMaps,
          gameType: model.gameType,
          gameSubType: model.gameSubType,
          turnRate: model.turnRate !== null ? model.turnRate : undefined,
          useLegacyLimits: model.useLegacyLimits,
        }),
      )
    }, 200),
  )
  const onSubmit = useCallback(
    (model: CreateLobbyModel) => {
      const {
        name,
        gameType,
        gameSubType,
        mapSelection: { mapId, recentMaps },
        turnRate,
        useLegacyLimits,
      } = model
      const subType = isTeamType(gameType) ? gameSubType : undefined

      dispatch(
        createLobby({
          name,
          map: mapId,
          gameType,
          gameSubType: subType,
          turnRate: turnRate === null ? undefined : turnRate,
          useLegacyLimits,
        }),
      )

      debouncedSavePrefrencesRef.current.cancel()

      const orderedRecentMaps = updateRecentMaps(mapId!, NUM_RECENT_MAPS, recentMaps)

      dispatch(
        updateLobbyPreferences({
          name: model.name,
          selectedMap: model.mapSelection.mapId,
          recentMaps: orderedRecentMaps,
          gameType: model.gameType,
          gameSubType: model.gameSubType,
          turnRate: model.turnRate !== null ? model.turnRate : undefined,
          useLegacyLimits: model.useLegacyLimits,
        }),
      )

      navigateToLobby(name)
    },
    [dispatch],
  )
  const onValidatedChange = useCallback((model: CreateLobbyModel) => {
    debouncedSavePrefrencesRef.current(model)
  }, [])

  useEffect(() => {
    dispatch(getLobbyPreferences())
  }, [dispatch])

  const isDisabled = isRequesting

  return (
    <Container>
      <TitleBar>
        <TextButton
          color='normal'
          label={t('lobbies.createLobby.backToList', 'Back to list')}
          iconStart={<MaterialIcon icon='arrow_back' />}
          onClick={props.onNavigateToList}
        />
        {browsingMaps === MapBrowseState.None ? (
          <>
            <Title>{t('lobbies.createLobby.title', 'Create lobby')}</Title>
            <ScrollDivider $show={!isAtTop} $showAt='bottom' />
          </>
        ) : undefined}
      </TitleBar>
      {browsingMaps === MapBrowseState.Server ? (
        <BrowseServerMaps
          title={t('lobbies.createLobby.selectMap', 'Select map')}
          onMapSelect={onMapSelect}
          onBrowseLocalMaps={onBrowseLocalMaps}
        />
      ) : undefined}
      {browsingMaps === MapBrowseState.Local ? (
        <BrowseLocalMaps onMapSelect={onMapSelect} />
      ) : undefined}
      {/*
          NOTE(tec27): We use display: none on these instead of just not rendering them so they
          maintain state while hidden
        */}
      <Contents $disabled={isDisabled} $hidden={browsingMaps !== MapBrowseState.None}>
        {topElem}
        <ContentsBody>
          {!isRequesting && hasLoaded ? (
            <CreateLobbyForm
              ref={formRef}
              disabled={isDisabled}
              model={model}
              onValidatedChange={onValidatedChange}
              onSubmit={onSubmit}
              onMapBrowse={onMapBrowse}
            />
          ) : (
            <LoadingDotsArea />
          )}
        </ContentsBody>
        {bottomElem}
      </Contents>
      <Actions $hidden={browsingMaps !== MapBrowseState.None}>
        <ScrollDivider $show={!isAtBottom} $showAt='top' />
        <RaisedButton
          label={t('lobbies.createLobby.title', 'Create lobby')}
          disabled={isDisabled}
          onClick={onCreateClick}
        />
      </Actions>
    </Container>
  )
}
