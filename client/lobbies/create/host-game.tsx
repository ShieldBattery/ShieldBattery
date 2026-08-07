import { TFunction } from 'i18next'
import { debounce } from 'lodash-es'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { LOBBY_NAME_MAXLENGTH } from '../../../common/constants'
import { GameType, isTeamType } from '../../../common/games/game-type'
import { LobbyVisibility } from '../../../common/lobbies'
import { UpdateLobbyPreferencesRequest } from '../../../common/lobbies/lobby-network'
import { SbMapId } from '../../../common/maps'
import { useSelfUser } from '../../auth/auth-utils'
import { openSimpleDialog } from '../../dialogs/action-creators'
import { MaterialIcon } from '../../icons/material/material-icon'
import { FilledButton, TextButton } from '../../material/button'
import { TextField } from '../../material/text-field'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { titleLarge } from '../../styles/typography'
import {
  createLobby,
  CreateLobbyParams,
  getLobbyPreferences,
  updateLobbyPreferences,
} from '../action-creators'
import { navigateToLobby } from '../lobby-url'
import {
  GameSetupForm,
  GameSetupFormHandle,
  GameSetupModel,
  Section,
  SectionHeader,
} from './game-setup-form'
import { VisibilityPicker } from './visibility-picker'

/** The most recent maps kept in the create form's preferences, newest first. */
const NUM_RECENT_MAPS = 5

const Content = styled.div`
  max-width: 960px;
  margin: 0 auto;
  padding: 16px 24px;

  display: flex;
  flex-direction: column;
  gap: 32px;
`

const HeaderBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
`

const Title = styled.div`
  ${titleLarge};
`

const CreateButton = styled(FilledButton)`
  align-self: flex-end;
`

const NameAndVisibilityRow = styled.div`
  display: flex;
  gap: 24px;
  align-items: flex-start;
  flex-wrap: wrap;
`

const LobbyNameField = styled(TextField)`
  flex: 0 1 320px;
  min-width: 240px;
`

const VisibilitySection = styled(Section)`
  flex: 1 1 400px;
  min-width: 0;
`

/** The lobby name shown by default when the field is left empty. */
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

/**
 * Returns `recentMaps` with `mapId` guaranteed to be a member, appending it (and evicting the
 * least-recent entry if already at the cap) when it isn't already there. The preferences endpoint
 * rejects a save whose `selectedMap` isn't among its own `recentMaps`, which a map picked through
 * the browse dialog wouldn't be until a lobby is actually created with it -- the autosave still
 * needs a valid pair before that happens, so it appends rather than leaving the map unsaved.
 */
function ensureMapIncluded(recentMaps: ReadonlyArray<SbMapId>, mapId: SbMapId): SbMapId[] {
  return recentMaps.includes(mapId)
    ? [...recentMaps]
    : [...recentMaps.slice(0, NUM_RECENT_MAPS - 1), mapId]
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
  // Mirrors whatever `GameSetupForm` currently holds, so a name/visibility edit's autosave (which
  // doesn't go through the form at all) still saves the setup fields alongside them.
  const [setup, setSetup] = useState<ReadonlyDeep<GameSetupModel>>({
    mapId: initial.selectedMap,
    gameType: initial.gameType,
    gameSubType: initial.gameSubType,
    useLegacyLimits: initial.useLegacyLimits,
    allowObservers: initial.allowObservers,
  })

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
      recentMaps: setup.mapId
        ? ensureMapIncluded(initial.recentMaps, setup.mapId)
        : initial.recentMaps,
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

  return (
    <Content>
      <HeaderBlock>
        {onNavigateToList ? (
          <TextButton
            label={t('lobbies.createLobby.backToList', 'Back to list')}
            iconStart={<MaterialIcon icon='arrow_back' />}
            onClick={onNavigateToList}
          />
        ) : null}

        <Title>{t('lobbies.hostGame.title', 'Host a game')}</Title>
      </HeaderBlock>

      <GameSetupForm
        ref={formRef}
        disabled={isCreating}
        model={setupModel}
        onValidatedChange={model => {
          setSetup(model)
          debouncedSaveRef.current?.()
        }}
        onSubmit={model => {
          const finalName = name.trim() ? name.trim() : defaultLobbyName(t, selfUser?.name)

          doCreateLobby({
            name: finalName,
            map: model.mapId!,
            gameType: model.gameType,
            gameSubType: isTeamType(model.gameType) ? model.gameSubType : undefined,
            useLegacyLimits: model.useLegacyLimits,
            allowObservers: model.allowObservers,
            visibility,
          })

          debouncedSaveRef.current?.cancel()

          savePreferences({
            // The preferences record what the user actually typed (possibly nothing), so a
            // left-empty name stays a ghost placeholder on the next visit instead of
            // materializing the auto-generated name into the field.
            name,
            selectedMap: model.mapId,
            recentMaps: updateRecentMaps(model.mapId!, initial.recentMaps),
            gameType: model.gameType,
            gameSubType: model.gameSubType,
            useLegacyLimits: model.useLegacyLimits,
            visibility,
            allowObservers: model.allowObservers,
          })
        }}
      />

      <NameAndVisibilityRow>
        <LobbyNameField
          value={name}
          onChange={event => {
            setName(event.target.value)
            debouncedSaveRef.current?.()
          }}
          disabled={isCreating}
          floatingLabel={true}
          label={t('lobbies.createLobby.lobbyName', 'Lobby name')}
          inputProps={{
            placeholder: defaultLobbyName(t, selfUser?.name),
            maxLength: LOBBY_NAME_MAXLENGTH,
            autoCapitalize: 'off',
            autoComplete: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}
        />

        <VisibilitySection>
          <SectionHeader>{t('lobbies.createLobby.visibility', 'Visibility')}</SectionHeader>
          <VisibilityPicker
            value={visibility}
            disabled={isCreating}
            onChange={value => {
              setVisibility(value)
              debouncedSaveRef.current?.()
            }}
          />
        </VisibilitySection>
      </NameAndVisibilityRow>

      <CreateButton
        label={t('lobbies.createLobby.title', 'Create lobby')}
        disabled={isCreating}
        onClick={() => formRef.current?.submit()}
      />
    </Content>
  )
}
