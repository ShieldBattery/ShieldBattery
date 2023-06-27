import { Immutable } from 'immer'
import { Range } from 'immutable'
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LOBBY_NAME_MAXLENGTH } from '../../common/constants'
import {
  ALL_GAME_TYPES,
  GameType,
  gameTypeToLabel,
  isTeamType,
} from '../../common/games/configuration'
import { MapInfoJson } from '../../common/maps'
import { closeOverlay, openOverlay } from '../activities/action-creators'
import { ActivityOverlayType } from '../activities/activity-overlay-type'
import { DisabledCard, DisabledOverlay, DisabledText } from '../activities/disabled-content'
import { useForm } from '../forms/form-hook'
import { SubmitOnEnter } from '../forms/submit-on-enter'
import { composeValidators, maxLength, required } from '../forms/validators'
import { MaterialIcon } from '../icons/material/material-icon'
import MapSelect from '../maps/map-select'
import { useAutoFocusRef } from '../material/auto-focus'
import { RaisedButton, TextButton } from '../material/button'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useValueAsRef } from '../state-hooks'
import { Headline5, headline5, subtitle1 } from '../styles/typography'
import {
  createLobby,
  getLobbyPreferences,
  navigateToLobby,
  updateLobbyPreferences,
} from './action-creators'
import { RecentMaps, recentMapsFromJs } from './lobby-preferences-reducer'

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
  selectedMap: string
  gameType: GameType
  gameSubType: number
}

interface CreateLobbyFormHandle {
  submit(): void
}

interface CreateLobbyFormProps {
  inputRef: React.Ref<HTMLInputElement>
  disabled: boolean
  model: CreateLobbyModel
  onSubmit: (model: CreateLobbyModel) => void
  onChange: (model: CreateLobbyModel) => void
  onMapBrowse: () => void
  recentMaps: RecentMaps
}

const CreateLobbyForm = React.forwardRef<CreateLobbyFormHandle, CreateLobbyFormProps>(
  (props, ref) => {
    const { t } = useTranslation()
    const { onSubmit, bindInput, bindCustom, getInputValue, setInputValue } = useForm(
      props.model,
      { name: lobbyNameValidator, selectedMap: selectedMapValidator },
      { onSubmit: props.onSubmit, onChange: props.onChange },
    )

    useImperativeHandle(ref, () => ({
      submit: onSubmit,
    }))

    const { inputRef, recentMaps, disabled, onMapBrowse } = props

    const gameType = getInputValue('gameType')
    const selectedMap = getInputValue('selectedMap')

    // TODO(tec27): There's probably a better way to do this via useEffect or useMemo, this is just
    // a direct conversion of the class component's behavior
    const lastGameTypeRef = useRef<GameType>()
    const lastSelectedMapRef = useRef<string>()

    useEffect(() => {
      const map = selectedMap ? recentMaps.byId.get(selectedMap) : undefined

      if (!selectedMap || !map) return

      // Ensure the `gameSubType` is always set to a default value when the `gameType` and/or the
      // `selectedMap` changes.
      if (lastGameTypeRef.current !== gameType || lastSelectedMapRef.current !== selectedMap) {
        lastGameTypeRef.current = gameType
        lastSelectedMapRef.current = selectedMap

        if (!isTeamType(gameType)) return

        // TODO(tec27): Really we should preserve the last value if possible, this always resets
        // the teams each time you change the map currently :(
        if (gameType === 'topVBottom') {
          setInputValue('gameSubType', Math.ceil(map.mapData.slots / 2))
        } else {
          setInputValue('gameSubType', 2)
        }
      }
    }, [gameType, selectedMap, setInputValue, recentMaps])

    let gameSubTypeSelection: React.ReactNode
    if (!isTeamType(gameType)) {
      gameSubTypeSelection = null
    } else {
      const selectedMapValue = getInputValue('selectedMap')
      const selectedMap = selectedMapValue ? recentMaps.byId.get(selectedMapValue) : undefined
      if (!selectedMap) {
        gameSubTypeSelection = null
      } else {
        const {
          mapData: { slots },
        } = selectedMap
        if (gameType === GameType.TopVsBottom) {
          gameSubTypeSelection = (
            <Select
              {...bindCustom('gameSubType')}
              label={t('lobbies.createLobby.gameSubTypeHeader', 'Teams')}
              disabled={disabled}
              tabIndex={0}>
              {Range(slots - 1, 0).map(top => (
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
              {Range(2, Math.min(slots, 4) + 1).map(numTeams => (
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
          ref={inputRef}
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
          list={recentMaps.list}
          byId={recentMaps.byId}
          disabled={disabled}
          maxSelections={1}
          thumbnailSize='large'
          canBrowseMaps={true}
          onMapBrowse={onMapBrowse}
        />
      </form>
    )
  },
)

export interface CreateLobbyProps {
  // TODO(tec27): Pass an id instead
  map?: Immutable<MapInfoJson>
  onNavigateToList: () => void
}

export function CreateLobby(props: CreateLobbyProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const lobbyPreferences = useAppSelector(s => s.lobbyPreferences)
  const {
    isRequesting,
    recentMaps: storeRecentMaps,
    name,
    gameType,
    gameSubType,
  } = lobbyPreferences

  const initialMap = props.map

  const selectedMap = initialMap?.id ?? lobbyPreferences.selectedMap
  const model = useMemo(
    () => ({
      name,
      gameType: gameType ?? 'melee',
      gameSubType,
      selectedMap: selectedMap ?? '',
    }),
    [name, gameType, gameSubType, selectedMap],
  )

  const recentMaps = useMemo(() => {
    const initialList: Immutable<MapInfoJson>[] = initialMap ? [initialMap] : []

    return recentMapsFromJs(
      initialList.concat(storeRecentMaps.byId.valueSeq().toArray()).slice(0, 5),
    )
  }, [storeRecentMaps, initialMap])
  const recentMapsRef = useValueAsRef(recentMaps)
  const isHostedRef = useRef(false)
  const lastFormModelRef = useRef<CreateLobbyModel>()

  const isInParty = useAppSelector(s => !!s.party.current)
  const formRef = useRef<CreateLobbyFormHandle>(null)
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()
  const [isAtTop, isAtBottom, topElem, bottomElem] = useScrollIndicatorState()

  const onCreateClick = useCallback(() => {
    formRef.current?.submit()
  }, [])
  const onMapSelect = useCallback(
    (map: Immutable<MapInfoJson>) => {
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

      lastFormModelRef.current = model
      const { name, gameType, gameSubType, selectedMap } = model
      const subType = isTeamType(gameType) ? gameSubType : undefined

      dispatch(createLobby(name, selectedMap, gameType, subType))
      isHostedRef.current = true
      navigateToLobby(name)
      dispatch(closeOverlay() as any)
    },
    [isInParty, dispatch],
  )
  const onChange = useCallback((model: CreateLobbyModel) => {
    lastFormModelRef.current = model
  }, [])

  useEffect(() => {
    dispatch(getLobbyPreferences())
  }, [dispatch])

  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const lastFormModel = lastFormModelRef.current
      if (!lastFormModel?.selectedMap) {
        // Might happen if this useEffect destructor is called before a selection has been made,
        // in which case these preferences are not submittable
        return
      }

      // eslint-disable-next-line react-hooks/exhaustive-deps
      let orderedRecentMaps = recentMapsRef.current.list
      // If the selected map is actually hosted, we move it to the front of the recent maps list
      if (isHostedRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        const { selectedMap } = lastFormModel
        orderedRecentMaps = orderedRecentMaps
          .delete(orderedRecentMaps.indexOf(selectedMap!))
          .unshift(selectedMap!)
      }

      dispatch(
        updateLobbyPreferences({
          ...lastFormModel,
          recentMaps: orderedRecentMaps.toArray(),
        }),
      )
    }
  }, [dispatch, recentMapsRef])

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
          {!isRequesting ? (
            <CreateLobbyForm
              ref={formRef}
              inputRef={autoFocusRef}
              disabled={isDisabled}
              model={model}
              onChange={onChange}
              onSubmit={onSubmit}
              recentMaps={recentMaps}
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
