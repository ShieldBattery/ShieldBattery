import { TFunction } from 'i18next'
import { debounce } from 'lodash-es'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { LOBBY_NAME_MAXLENGTH } from '../../../common/constants'
import { GameType, gameTypeToLabel, isTeamType } from '../../../common/games/game-type'
import { LobbyVisibility, NUM_RECENT_MAPS } from '../../../common/lobbies'
import { UpdateLobbyPreferencesRequest } from '../../../common/lobbies/lobby-network'
import { SbMapId } from '../../../common/maps'
import { useTrackPageView } from '../../analytics/analytics'
import { useSelfUser } from '../../auth/auth-utils'
import { openDialog, openSimpleDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { FilledButton } from '../../material/button'
import { TextField } from '../../material/text-field'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import {
  createLobby,
  CreateLobbyParams,
  getLobbyPreferences,
  updateLobbyPreferences,
} from '../action-creators'
import { isInLobby } from '../lobby-reducer'
import { navigateToLobby } from '../lobby-url'
import {
  GameSetupForm,
  GameSetupFormHandle,
  GameSetupModel,
  Section,
  SectionHeader,
} from './game-setup-form'
import { formatGameSetupSummary, GameSetupPage, MapBrowseState } from './game-setup-page'
import { VisibilityPicker } from './visibility-picker'

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
`

/** The lobby name shown by default when the field is left empty and no map has been picked yet. */
function defaultLobbyName(t: TFunction, selfUserName: string | undefined): string {
  return selfUserName
    ? t('lobbies.hostGame.defaultLobbyName', {
        defaultValue: "{{name}}'s lobby",
        name: selfUserName,
      })
    : t('lobbies.hostGame.defaultLobbyNameFallback', 'My lobby')
}

/**
 * Updates the list of recent maps given that `selectedId` is a newly selected map, moving it to
 * the front.
 */
function updateRecentMaps(selectedId: SbMapId, recentMaps: ReadonlyArray<SbMapId>): SbMapId[] {
  return [selectedId, ...recentMaps.filter(m => m !== selectedId).slice(0, NUM_RECENT_MAPS - 1)]
}

export interface HostGameProps {
  onNavigateToList?: () => void
  /**
   * When set, called with the request the form would have sent instead of creating a lobby on the
   * server (and navigating into it). Lets dev pages exercise the full form flow without producing
   * real lobbies.
   */
  createLobbyOverride?: (params: CreateLobbyParams) => void
  /**
   * When set, called with the preferences that would have been saved instead of persisting them
   * to the server. Lets dev pages exercise the form without overwriting the user's real saved
   * preferences.
   */
  savePreferencesOverride?: (prefs: ReadonlyDeep<UpdateLobbyPreferencesRequest>) => void
}

/**
 * The redesigned "Host a game" surface: a form built on the shared `GameSetupForm` core, prefilled
 * from the user's saved lobby preferences.
 */
export function HostGame(props: HostGameProps) {
  useTrackPageView('/lobbies/create')

  const dispatch = useAppDispatch()
  const hasLoaded = useAppSelector(s => s.lobbyPreferences.hasLoaded)
  const isRequesting = useAppSelector(s => s.lobbyPreferences.isRequesting)

  useEffect(() => {
    dispatch(getLobbyPreferences())
  }, [dispatch])

  if (isRequesting || !hasLoaded) {
    return (
      <LoadingContainer>
        <LoadingDotsArea />
      </LoadingContainer>
    )
  }

  return <HostGameContent {...props} />
}

function HostGameContent({
  onNavigateToList,
  createLobbyOverride,
  savePreferencesOverride,
}: HostGameProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()

  // Gates the leave-and-create confirmation dialog on submit: the server can only ever seat a
  // client in one lobby at a time, so creating a new one while already in another means leaving
  // it, which is worth confirming before it happens.
  const inCurrentLobby = useAppSelector(s => isInLobby(s.lobby))

  const prefsName = useAppSelector(s => s.lobbyPreferences.name)
  const prefsGameType = useAppSelector(s => s.lobbyPreferences.gameType)
  const prefsGameSubType = useAppSelector(s => s.lobbyPreferences.gameSubType)
  const prefsUseLegacyLimits = useAppSelector(s => s.lobbyPreferences.useLegacyLimits)
  const prefsVisibility = useAppSelector(s => s.lobbyPreferences.visibility)
  const prefsAllowObservers = useAppSelector(s => s.lobbyPreferences.allowObservers)
  const prefsSelectedMap = useAppSelector(s => s.lobbyPreferences.selectedMap)
  const prefsRecentMaps = useAppSelector(s => s.lobbyPreferences.recentMaps)

  // Captured once when this mounts (which only happens once preferences have loaded): the form's
  // starting point. Later preference changes -- including this component's own autosaves as the
  // form below is edited -- intentionally don't feed back into it, or an in-progress, unsubmitted
  // edit would keep overwriting what the user is typing.
  const [initial] = useState(() => ({
    name: prefsName,
    gameType: prefsGameType ?? GameType.Melee,
    gameSubType: prefsGameSubType,
    useLegacyLimits: prefsUseLegacyLimits ?? false,
    visibility: prefsVisibility ?? ('listed' as LobbyVisibility),
    allowObservers: prefsAllowObservers ?? true,
    selectedMap: prefsSelectedMap ?? undefined,
    recentMaps: prefsRecentMaps,
  }))

  const [isCreating, setIsCreating] = useState(false)
  const [name, setName] = useState(initial.name)
  const [visibility, setVisibility] = useState<LobbyVisibility>(initial.visibility)
  // The recent-maps list shown next to the form. Maps picked through the map browser are promoted
  // into it immediately (not just once a lobby is created), so the previously selected map stays
  // one click away after changing maps. This also keeps the invariant the preferences endpoint
  // demands: any selected map is always among the saved recent maps.
  const [recentMaps, setRecentMaps] = useState(initial.recentMaps)
  // Mirrors whatever `GameSetupForm` currently holds, so a name/visibility edit's autosave (which
  // doesn't go through the form at all) still saves the setup fields alongside them.
  const [setup, setSetup] = useState<ReadonlyDeep<GameSetupModel>>({
    mapId: initial.selectedMap,
    gameType: initial.gameType,
    gameSubType: initial.gameSubType,
    useLegacyLimits: initial.useLegacyLimits,
    allowObservers: initial.allowObservers,
  })

  const selectedMapInfo = useAppSelector(s =>
    setup.mapId ? s.maps.byId.get(setup.mapId) : undefined,
  )

  const savePreferences = (prefs: ReadonlyDeep<UpdateLobbyPreferencesRequest>) => {
    if (savePreferencesOverride) {
      savePreferencesOverride(prefs)
    } else {
      dispatch(updateLobbyPreferences(prefs))
    }
  }

  // A debounced save always fires after whichever render triggered it, so it needs to read
  // whatever `name`/`visibility`/`setup` are by the time it actually runs rather than whatever
  // they were when the debounce was created; `useEffectEvent` gives a stable function that always
  // sees the latest values without that staleness.
  const saveNow = useEffectEvent(() => {
    savePreferences({
      name,
      selectedMap: setup.mapId,
      recentMaps,
      gameType: setup.gameType,
      gameSubType: setup.gameSubType,
      useLegacyLimits: setup.useLegacyLimits,
      visibility,
      allowObservers: setup.allowObservers,
    })
  })

  // Built once (in an Effect, so the Effect Event above may be called from within it) and exposed
  // through a ref so the form and the fields below can all share and debounce against the same
  // pending save.
  const debouncedSaveRef = useRef<ReturnType<typeof debounce> | null>(null)
  useEffect(() => {
    const debouncedSave = debounce(() => {
      saveNow()
    }, 200)
    debouncedSaveRef.current = debouncedSave
    return () => {
      debouncedSave.cancel()
      debouncedSaveRef.current = null
    }
  }, [])

  const formRef = useRef<GameSetupFormHandle>(null)
  const [browseState, setBrowseState] = useState(MapBrowseState.None)

  const pick = (mapId: SbMapId) => {
    setRecentMaps(maps => updateRecentMaps(mapId, maps))
    formRef.current?.setMap(mapId)
    setBrowseState(MapBrowseState.None)
  }

  const showErrorDialog = () => {
    dispatch(
      openSimpleDialog(
        t('lobbies.createLobby.errorDialogTitle', 'Error creating lobby'),
        t(
          'lobbies.createLobby.errorGeneric',
          'Something went wrong while creating the lobby. Please try again.',
        ),
      ),
    )
  }

  const doCreateLobby = (params: CreateLobbyParams) => {
    if (createLobbyOverride) {
      createLobbyOverride(params)
      return
    }

    setIsCreating(true)
    dispatch(
      createLobby(params, {
        onSuccess: result => navigateToLobby(result.id, params.name),
        onError: () => {
          setIsCreating(false)
          showErrorDialog()
        },
      }),
    )
  }

  const setupModel: GameSetupModel = {
    mapId: initial.selectedMap,
    gameType: initial.gameType,
    gameSubType: initial.gameSubType,
    useLegacyLimits: initial.useLegacyLimits,
    allowObservers: initial.allowObservers,
  }

  // Once a map is selected, the placeholder names the lobby after the map and game type instead
  // of the host, since that's more informative to players browsing the lobby list. This string
  // becomes the actual lobby name when the field is left empty, and map names are unbounded, so
  // when the map-based name would exceed the lobby name cap (and be rejected by the server), the
  // host-based name is used instead.
  let placeholderName = defaultLobbyName(t, selfUser?.name)
  if (selectedMapInfo) {
    const mapBasedName = t('lobbies.hostGame.defaultLobbyNameFromMap', {
      defaultValue: '{{mapName}} {{gameType}}',
      mapName: selectedMapInfo.name,
      gameType: gameTypeToLabel(setup.gameType, t).toLocaleLowerCase(),
    })
    if (mapBasedName.length <= LOBBY_NAME_MAXLENGTH) {
      placeholderName = mapBasedName
    }
  }

  const summary = formatGameSetupSummary(t, { visibility, setup, mapInfo: selectedMapInfo })

  return (
    <GameSetupPage
      title={t('lobbies.createLobby.title', 'Create lobby')}
      onBack={onNavigateToList}
      browseState={browseState}
      onBrowseStateChange={setBrowseState}
      onMapPicked={pick}
      summary={summary}
      footerActions={
        <FilledButton
          label={t('lobbies.createLobby.title', 'Create lobby')}
          disabled={isCreating}
          onClick={() => formRef.current?.submit()}
          testName='create-lobby-submit'
        />
      }>
      <GameSetupForm
        ref={formRef}
        disabled={isCreating}
        model={setupModel}
        recentMaps={recentMaps}
        nameSection={
          <TextField
            value={name}
            onChange={event => {
              setName(event.target.value)
              debouncedSaveRef.current?.()
            }}
            disabled={isCreating}
            floatingLabel={true}
            alwaysHasValue={true}
            label={t('lobbies.createLobby.lobbyName', 'Lobby name')}
            testName='lobby-name-input'
            inputProps={{
              placeholder: placeholderName,
              maxLength: LOBBY_NAME_MAXLENGTH,
              autoCapitalize: 'off',
              autoComplete: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}
          />
        }
        visibilitySection={
          <Section>
            <SectionHeader>{t('lobbies.createLobby.visibility', 'Visibility')}</SectionHeader>
            <VisibilityPicker
              value={visibility}
              disabled={isCreating}
              onChange={value => {
                setVisibility(value)
                debouncedSaveRef.current?.()
              }}
            />
          </Section>
        }
        onChangeMap={() => setBrowseState(MapBrowseState.Server)}
        onValidatedChange={model => {
          setSetup(model)
          debouncedSaveRef.current?.()
        }}
        onSubmit={model => {
          const finalName = name.trim() ? name.trim() : placeholderName

          const params: CreateLobbyParams = {
            name: finalName,
            map: model.mapId!,
            gameType: model.gameType,
            gameSubType: isTeamType(model.gameType) ? model.gameSubType : undefined,
            useLegacyLimits: model.useLegacyLimits,
            allowObservers: model.allowObservers,
            visibility,
            leaveCurrentLobby: inCurrentLobby,
          }

          // Trading the current lobby for a new one is worth confirming before it happens;
          // the dialog performs no request of its own, so `doCreateLobby` runs unchanged once
          // it's confirmed.
          if (inCurrentLobby) {
            dispatch(
              openDialog({
                type: DialogType.LobbyLeaveAndCreate,
                initData: { onConfirm: () => doCreateLobby(params) },
              }),
            )
          } else {
            doCreateLobby(params)
          }

          debouncedSaveRef.current?.cancel()

          savePreferences({
            // The preferences record what the user actually typed (possibly nothing), so a
            // left-empty name stays a ghost placeholder on the next visit instead of
            // materializing the auto-generated name into the field.
            name,
            selectedMap: model.mapId,
            recentMaps: updateRecentMaps(model.mapId!, recentMaps),
            gameType: model.gameType,
            gameSubType: model.gameSubType,
            useLegacyLimits: model.useLegacyLimits,
            visibility,
            allowObservers: model.allowObservers,
          })
        }}
      />
    </GameSetupPage>
  )
}
