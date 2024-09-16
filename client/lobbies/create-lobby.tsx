import { debounce } from 'lodash-es'
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { LOBBY_NAME_MAXLENGTH } from '../../common/constants.js'
import {
  ALL_GAME_TYPES,
  GameType,
  gameTypeToLabel,
  isTeamType,
} from '../../common/games/configuration.js'
import { MapInfoJson } from '../../common/maps.js'
import { ALL_TURN_RATES, BwTurnRate } from '../../common/network.js'
import { range } from '../../common/range.js'
import { closeOverlay, openOverlay } from '../activities/action-creators.js'
import { ActivityOverlayType } from '../activities/activity-overlay-type.js'
import { DisabledCard, DisabledOverlay, DisabledText } from '../activities/disabled-content.js'
import { useForm } from '../forms/form-hook.js'
import { SubmitOnEnter } from '../forms/submit-on-enter.js'
import { composeValidators, maxLength, required } from '../forms/validators.js'
import { MaterialIcon } from '../icons/material/material-icon.js'
import { MapSelect } from '../maps/map-select.js'
import { useAutoFocusRef } from '../material/auto-focus.js'
import { RaisedButton, TextButton } from '../material/button.js'
import { CheckBox } from '../material/check-box.js'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator.js'
import { SelectOption } from '../material/select/option.js'
import { Select } from '../material/select/select.js'
import { TextField } from '../material/text-field.js'
import { LoadingDotsArea } from '../progress/dots.js'
import { useAppDispatch, useAppSelector } from '../redux-hooks.js'
import { useValueAsRef } from '../state-hooks.js'
import { Headline5, headline5, subtitle1 } from '../styles/typography.js'
import {
  createLobby,
  getLobbyPreferences,
  navigateToLobby,
  updateLobbyPreferences,
} from './action-creators.js'

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
  ${headline5};
  padding: 8px 16px 0;
`

const Contents = styled.div<{ $disabled: boolean }>`
  position: relative;
  flex-grow: 1;

  contain: strict;
  overflow-y: ${props => (props.$disabled ? 'hidden' : 'auto')};
`

const ContentsBody = styled.div`
  padding: 12px 24px;
`

const Actions = styled.div`
  position: relative;
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
  ${subtitle1};
  margin: 16px 0;
`

const lobbyNameValidator = composeValidators(
  required(t => t('lobbies.createLobby.lobbyNameRequired', 'Enter a lobby name')),
  maxLength(LOBBY_NAME_MAXLENGTH),
)
const selectedMapValidator = required(t =>
  t('lobbies.createLobby.mapRequired', 'Select a map to play'),
)

interface CreateLobbyModel {
  name: string
  selectedMap?: string
  gameType: GameType
  gameSubType: number
  turnRate: BwTurnRate | 0 | null
  useLegacyLimits: boolean
}

interface CreateLobbyFormHandle {
  submit(): void
}

interface CreateLobbyFormProps {
  disabled: boolean
  model: CreateLobbyModel
  onSubmit: (model: CreateLobbyModel) => void
  onValidatedChange: (model: CreateLobbyModel) => void
  onMapBrowse: () => void
  quickMaps: ReadonlyArray<string>
}

const TURN_RATE_OPTIONS: ReadonlyArray<BwTurnRate> = ALL_TURN_RATES.slice(0).sort((a, b) => b - a)

const CreateLobbyForm = React.forwardRef<CreateLobbyFormHandle, CreateLobbyFormProps>(
  (props, ref) => {
    const { t } = useTranslation()
    const { onSubmit, bindInput, bindCustom, bindCheckable, getInputValue, setInputValue } =
      useForm(
        props.model,
        { name: lobbyNameValidator, selectedMap: selectedMapValidator },
        { onSubmit: props.onSubmit, onValidatedChange: props.onValidatedChange },
      )
    const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

    useImperativeHandle(ref, () => ({
      submit: onSubmit,
    }))

    const { quickMaps, disabled, onMapBrowse } = props

    const selectedMap = getInputValue('selectedMap')
    const gameType = getInputValue('gameType')

    const selectedMapInfo = useAppSelector(s => selectedMap && s.maps2.byId.get(selectedMap))

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
          {...bindCustom('selectedMap')}
          quickMaps={quickMaps}
          disabled={disabled}
          onMapBrowse={onMapBrowse}
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
  initName?: string
  mapId?: string
  onNavigateToList: () => void
}

export function CreateLobby(props: CreateLobbyProps) {
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

  const initialMapId = props.mapId
  const initialName = props.initName ?? prefsName ?? ''

  const selectedMap = initialMapId ?? storeSelectedMap
  const model = useMemo(
    () =>
      ({
        name: initialName,
        gameType: gameType ?? 'melee',
        gameSubType,
        selectedMap,
        turnRate: turnRate ?? null,
        useLegacyLimits: useLegacyLimits ?? false,
      }) satisfies CreateLobbyModel,
    [initialName, gameType, gameSubType, selectedMap, turnRate, useLegacyLimits],
  )

  const recentMaps = useMemo(() => {
    const initialList = initialMapId ? [initialMapId] : []
    return initialList.concat(storeRecentMaps.toArray().filter(m => m !== initialMapId)).slice(0, 5)
  }, [storeRecentMaps, initialMapId])
  const recentMapsRef = useValueAsRef(recentMaps)

  const isInParty = useAppSelector(s => !!s.party.current)
  const formRef = useRef<CreateLobbyFormHandle>(null)
  const [isAtTop, isAtBottom, topElem, bottomElem] = useScrollIndicatorState()

  const onCreateClick = useCallback(() => {
    formRef.current?.submit()
  }, [])
  const onMapSelect = useCallback(
    (map: ReadonlyDeep<MapInfoJson>) => {
      dispatch(openOverlay({ type: ActivityOverlayType.Lobby, initData: { map, creating: true } }))
    },
    [dispatch],
  )
  const onMapBrowse = useCallback(() => {
    if (isInParty) {
      return
    }

    dispatch(
      openOverlay({
        type: ActivityOverlayType.BrowseServerMaps,
        initData: {
          title: t('lobbies.createLobby.selectMap', 'Select map'),
          onMapSelect,
          onMapUpload: onMapSelect,
        },
      }),
    )
  }, [isInParty, dispatch, t, onMapSelect])
  const onSubmit = useCallback(
    (model: CreateLobbyModel) => {
      if (isInParty) {
        return
      }

      const { name, gameType, gameSubType, selectedMap, turnRate, useLegacyLimits } = model
      const subType = isTeamType(gameType) ? gameSubType : undefined

      dispatch(
        createLobby({
          name,
          map: selectedMap,
          gameType,
          gameSubType: subType,
          turnRate: turnRate === null ? undefined : turnRate,
          useLegacyLimits,
        }),
      )

      // Move the hosted map to the front of the recent maps list
      const orderedRecentMaps = recentMapsRef.current.filter(m => m !== selectedMap).slice(0, 4)
      orderedRecentMaps.unshift(selectedMap!)

      dispatch(
        updateLobbyPreferences({
          ...model,
          turnRate: model.turnRate !== null ? model.turnRate : undefined,
          recentMaps: orderedRecentMaps,
        }),
      )

      navigateToLobby(name)
      dispatch(closeOverlay() as any)
    },
    [isInParty, dispatch, recentMapsRef],
  )

  const debouncedSavePrefrencesRef = useRef(
    debounce((model: CreateLobbyModel) => {
      dispatch(
        updateLobbyPreferences({
          ...model,
          turnRate: model.turnRate !== null ? model.turnRate : undefined,
          recentMaps: recentMapsRef.current,
        }),
      )
    }, 200),
  )
  const onValidatedChange = useCallback((model: CreateLobbyModel) => {
    debouncedSavePrefrencesRef.current(model)
  }, [])

  useEffect(() => {
    dispatch(getLobbyPreferences())
  }, [dispatch])

  const isDisabled = isInParty || isRequesting

  return (
    <Container>
      <TitleBar>
        <TextButton
          color='normal'
          label={t('lobbies.createLobby.backToList', 'Back to list')}
          iconStart={<MaterialIcon icon='arrow_back' />}
          onClick={props.onNavigateToList}
        />
        <Title>{t('lobbies.createLobby.title', 'Create lobby')}</Title>
        <ScrollDivider $show={!isAtTop} $showAt='bottom' />
      </TitleBar>
      <Contents $disabled={isDisabled}>
        {topElem}
        <ContentsBody>
          {!isRequesting && hasLoaded ? (
            <CreateLobbyForm
              ref={formRef}
              disabled={isDisabled}
              model={model}
              onValidatedChange={onValidatedChange}
              onSubmit={onSubmit}
              quickMaps={recentMaps}
              onMapBrowse={onMapBrowse}
            />
          ) : (
            <LoadingDotsArea />
          )}
        </ContentsBody>
        {bottomElem}
        {isInParty ? (
          <DisabledOverlay>
            <DisabledCard>
              <Headline5>
                {t('lobbies.createLobby.disabledInPartyTitle', 'Disabled while in party')}
              </Headline5>
              <DisabledText>
                <Trans t={t} i18nKey='lobbies.createLobby.disabledInPartyText'>
                  Creating a lobby as a party is currently under development. Leave your party to
                  continue.
                </Trans>
              </DisabledText>
            </DisabledCard>
          </DisabledOverlay>
        ) : null}
      </Contents>
      <Actions>
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
