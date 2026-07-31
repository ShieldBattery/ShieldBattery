import { debounce } from 'lodash-es'
import { InvokeError } from 'nydus-client'
import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { LOBBY_NAME_MAXLENGTH } from '../../common/constants'
import { ALL_GAME_TYPES, GameType, gameTypeToLabel, isTeamType } from '../../common/games/game-type'
import { LobbyVisibility } from '../../common/lobbies'
import { LobbyCreateErrorCode } from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { SbMapId } from '../../common/maps'
import { range } from '../../common/range'
import { useTrackPageView } from '../analytics/analytics'
import { openSimpleDialog } from '../dialogs/action-creators'
import { useForm, useFormCallbacks, Validator } from '../forms/form-hook'
import { SubmitOnEnter } from '../forms/submit-on-enter'
import { composeValidators, maxLength, required } from '../forms/validators'
import { MaterialIcon } from '../icons/material/material-icon'
import { BrowseLocalMaps } from '../maps/browse-local-maps'
import { BrowseServerMaps } from '../maps/browse-server-maps'
import { MapSelect, MapSelectionValue } from '../maps/map-select'
import { useAutoFocusRef } from '../material/auto-focus'
import { FilledButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { RadioButton, RadioGroup } from '../material/radio'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, bodySmall, titleLarge } from '../styles/typography'
import { createLobby, getLobbyPreferences, updateLobbyPreferences } from './action-creators'
import { navigateToLobby } from './lobby-url'

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

const VisibilitySettings = styled.div`
  max-width: 400px;
  margin-top: 32px;
`

const AdvancedSettings = styled.div`
  max-width: 320px;
  margin-top: 32px;
`

const SectionHeader = styled.div`
  ${bodyLarge};
  margin: 16px 0;
`

// Spans rather than divs: these render inside a <label>, which only accepts phrasing content.
const VisibilityOptionName = styled.span`
  display: block;
`

const VisibilityOptionDescription = styled.span`
  ${bodySmall};
  display: block;
  color: var(--theme-on-surface-variant);
`

interface CreateLobbyModel {
  name: string
  mapSelection: MapSelectionValue
  gameType: GameType
  gameSubType: number
  useLegacyLimits: boolean
  visibility: LobbyVisibility
  allowObservers: boolean
}

const lobbyNameValidator = composeValidators(
  required(t => t('lobbies.createLobby.lobbyNameRequired', 'Enter a lobby name')),
  maxLength(LOBBY_NAME_MAXLENGTH),
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
  onSubmit: (model: ReadonlyDeep<CreateLobbyModel>) => void
  onValidatedChange: (model: ReadonlyDeep<CreateLobbyModel>) => void
  onMapBrowse: (onMapSelect: (mapId: SbMapId) => void) => void
  ref?: React.Ref<CreateLobbyFormHandle>
}

/** Updates the list of recent maps given that `selectedId` is a newly selected map. */
function updateRecentMaps(
  selectedId: SbMapId,
  numRecentMaps: number,
  recentMaps: ReadonlyArray<SbMapId> = [],
): SbMapId[] {
  return [selectedId, ...recentMaps.filter(m => m !== selectedId).slice(0, numRecentMaps - 1)]
}

function CreateLobbyForm({
  disabled,
  model,
  onSubmit,
  onValidatedChange,
  onMapBrowse,
  ref,
}: CreateLobbyFormProps) {
  const { t } = useTranslation()
  const { submit, bindInput, bindCustom, bindCheckable, getInputValue, setInputValue, form } =
    useForm<CreateLobbyModel>(model, {
      name: lobbyNameValidator,
      mapSelection: mapSelectionValidator,
    })

  useFormCallbacks(form, {
    onValidatedChange,
    onSubmit,
  })

  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  useImperativeHandle(ref, () => ({
    submit,
  }))

  const mapSelection = getInputValue('mapSelection')
  const selectedMap = mapSelection.mapId
  const gameType = getInputValue('gameType')

  const selectedMapInfo = useAppSelector(s => selectedMap && s.maps.byId.get(selectedMap))

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
  }, [gameType, selectedMapInfo, form, getInputValue, setInputValue])

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
    <form noValidate={true} onSubmit={submit}>
      <SubmitOnEnter disabled={disabled} />
      <TextField
        {...bindInput('name')}
        ref={autoFocusRef}
        label={t('lobbies.createLobby.lobbyName', 'Lobby name')}
        disabled={disabled}
        floatingLabel={true}
        testName='lobby-name-input'
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

      <VisibilitySettings>
        <SectionHeader>{t('lobbies.createLobby.visibility', 'Visibility')}</SectionHeader>
        <RadioGroup {...bindInput('visibility')}>
          <RadioButton
            value='listed'
            disabled={disabled}
            label={
              <>
                <VisibilityOptionName>
                  {t('lobbies.createLobby.visibilityListed', 'Public')}
                </VisibilityOptionName>
                <VisibilityOptionDescription>
                  {t(
                    'lobbies.createLobby.visibilityListedDescription',
                    'Shown in the lobby list for anyone to join',
                  )}
                </VisibilityOptionDescription>
              </>
            }
          />
          <RadioButton
            value='unlisted'
            disabled={disabled}
            label={
              <>
                <VisibilityOptionName>
                  {t('lobbies.createLobby.visibilityUnlisted', 'Unlisted')}
                </VisibilityOptionName>
                <VisibilityOptionDescription>
                  {t(
                    'lobbies.createLobby.visibilityUnlistedDescription',
                    'Only people you share the link with can join',
                  )}
                </VisibilityOptionDescription>
              </>
            }
          />
        </RadioGroup>
      </VisibilitySettings>

      <AdvancedSettings>
        <SectionHeader>
          {t('lobbies.createLobby.advancedSettings', 'Advanced settings')}
        </SectionHeader>
        <CheckBox
          {...bindCheckable('useLegacyLimits')}
          label={t('lobbies.createLobby.useLegacyLimits', 'Use legacy unit limit')}
          disabled={disabled}
          inputProps={{ tabIndex: 0 }}
        />
        <CheckBox
          {...bindCheckable('allowObservers')}
          label={t('lobbies.createLobby.allowObservers', 'Allow observers')}
          disabled={disabled}
          inputProps={{ tabIndex: 0 }}
        />
      </AdvancedSettings>
    </form>
  )
}

export interface CreateLobbyProps {
  onNavigateToList: () => void
}

enum MapBrowseState {
  None,
  Server,
  Local,
}

export function CreateLobby(props: CreateLobbyProps) {
  useTrackPageView('/lobbies/create')

  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const isRequesting = useAppSelector(s => s.lobbyPreferences.isRequesting)
  const hasLoaded = useAppSelector(s => s.lobbyPreferences.hasLoaded)
  const prefsName = useAppSelector(s => s.lobbyPreferences.name)
  const gameType = useAppSelector(s => s.lobbyPreferences.gameType)
  const gameSubType = useAppSelector(s => s.lobbyPreferences.gameSubType)
  const useLegacyLimits = useAppSelector(s => s.lobbyPreferences.useLegacyLimits)
  const prefsVisibility = useAppSelector(s => s.lobbyPreferences.visibility)
  const prefsAllowObservers = useAppSelector(s => s.lobbyPreferences.allowObservers)

  const storeSelectedMap = useAppSelector(s => s.lobbyPreferences.selectedMap)
  const storeRecentMaps = useAppSelector(s => s.lobbyPreferences.recentMaps)

  const initialName = prefsName ?? ''

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
        useLegacyLimits: useLegacyLimits ?? false,
        visibility: prefsVisibility ?? 'listed',
        allowObservers: prefsAllowObservers ?? true,
      }) satisfies CreateLobbyModel,
    [
      initialName,
      gameType,
      gameSubType,
      storeSelectedMap,
      storeRecentMaps,
      useLegacyLimits,
      prefsVisibility,
      prefsAllowObservers,
    ],
  )

  const formRef = useRef<CreateLobbyFormHandle>(null)
  const [isAtTop, isAtBottom, topElem, bottomElem] = useScrollIndicatorState()

  const [browsingMaps, setBrowsingMaps] = useState(MapBrowseState.None)
  const [isCreating, setIsCreating] = useState(false)
  const mapSelectCallbackRef = useRef<(mapId: SbMapId) => void>(undefined)
  const debouncedSavePreferencesRef = useRef(
    debounce((model: ReadonlyDeep<CreateLobbyModel>) => {
      dispatch(
        updateLobbyPreferences({
          name: model.name,
          selectedMap: model.mapSelection.mapId,
          recentMaps: model.mapSelection.recentMaps,
          gameType: model.gameType,
          gameSubType: model.gameSubType,
          useLegacyLimits: model.useLegacyLimits,
          visibility: model.visibility,
          allowObservers: model.allowObservers,
        }),
      )
    }, 200),
  )

  useEffect(() => {
    dispatch(getLobbyPreferences())
  }, [dispatch])

  const isDisabled = isRequesting || isCreating

  return (
    <Container>
      <TitleBar>
        <TextButton
          label={
            browsingMaps === MapBrowseState.None
              ? t('lobbies.createLobby.backToList', 'Back to list')
              : t('common.actions.back', 'Back')
          }
          iconStart={<MaterialIcon icon='arrow_back' />}
          onClick={
            browsingMaps === MapBrowseState.None
              ? props.onNavigateToList
              : () => setBrowsingMaps(MapBrowseState.None)
          }
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
          onMapClick={mapId => {
            mapSelectCallbackRef.current?.(mapId)
            mapSelectCallbackRef.current = undefined
            setBrowsingMaps(MapBrowseState.None)
          }}
          onBrowseLocalMaps={() => {
            setBrowsingMaps(MapBrowseState.Local)
          }}
        />
      ) : undefined}
      {browsingMaps === MapBrowseState.Local ? (
        <BrowseLocalMaps
          onMapUpload={mapId => {
            mapSelectCallbackRef.current?.(mapId)
            mapSelectCallbackRef.current = undefined
            setBrowsingMaps(MapBrowseState.None)
          }}
        />
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
              onValidatedChange={model => {
                debouncedSavePreferencesRef.current(model)
              }}
              onSubmit={model => {
                const {
                  name,
                  gameType,
                  gameSubType,
                  mapSelection: { mapId, recentMaps },
                  useLegacyLimits,
                  visibility,
                  allowObservers,
                } = model
                const subType = isTeamType(gameType) ? gameSubType : undefined

                setIsCreating(true)
                dispatch(
                  createLobby(
                    {
                      name,
                      map: mapId,
                      gameType,
                      gameSubType: subType,
                      useLegacyLimits,
                      visibility,
                      allowObservers,
                    },
                    {
                      onSuccess: (result: { id: SbLobbyId }) => navigateToLobby(result.id, name),
                      onError: (err: Error) => {
                        setIsCreating(false)
                        dispatch(
                          openSimpleDialog(
                            t('lobbies.createLobby.errorDialogTitle', 'Error creating lobby'),
                            err instanceof InvokeError &&
                              err.body?.code === LobbyCreateErrorCode.NameTaken
                              ? t(
                                  'lobbies.createLobby.errorNameTaken',
                                  'A lobby with that name already exists. Please choose a different name.',
                                )
                              : t(
                                  'lobbies.createLobby.errorGeneric',
                                  'Something went wrong while creating the lobby. Please try again.',
                                ),
                          ),
                        )
                      },
                    },
                  ),
                )

                debouncedSavePreferencesRef.current.cancel()

                const orderedRecentMaps = updateRecentMaps(mapId!, NUM_RECENT_MAPS, recentMaps)

                dispatch(
                  updateLobbyPreferences({
                    name: model.name,
                    selectedMap: model.mapSelection.mapId,
                    recentMaps: orderedRecentMaps,
                    gameType: model.gameType,
                    gameSubType: model.gameSubType,
                    useLegacyLimits: model.useLegacyLimits,
                    visibility: model.visibility,
                    allowObservers: model.allowObservers,
                  }),
                )
              }}
              onMapBrowse={mapSelectCallback => {
                mapSelectCallbackRef.current = mapSelectCallback
                setBrowsingMaps(MapBrowseState.Server)
              }}
            />
          ) : (
            <LoadingDotsArea />
          )}
        </ContentsBody>
        {bottomElem}
      </Contents>
      <Actions $hidden={browsingMaps !== MapBrowseState.None}>
        <ScrollDivider $show={!isAtBottom} $showAt='top' />
        <FilledButton
          label={t('lobbies.createLobby.title', 'Create lobby')}
          disabled={isDisabled}
          onClick={() => {
            formRef.current?.submit()
          }}
          testName='create-lobby-submit'
        />
      </Actions>
    </Container>
  )
}
