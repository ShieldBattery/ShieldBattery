import { TFunction } from 'i18next'
import { debounce } from 'lodash-es'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { LOBBY_NAME_MAXLENGTH } from '../../../common/constants'
import { GameType, gameTypeToLabel, isTeamType } from '../../../common/games/game-type'
import { LobbyVisibility } from '../../../common/lobbies'
import { UpdateLobbyPreferencesRequest } from '../../../common/lobbies/lobby-network'
import { SbMapId } from '../../../common/maps'
import { useTrackPageView } from '../../analytics/analytics'
import { useSelfUser } from '../../auth/auth-utils'
import { openSimpleDialog } from '../../dialogs/action-creators'
import { MaterialIcon } from '../../icons/material/material-icon'
import { BrowseLocalMaps } from '../../maps/browse-local-maps'
import { BrowseServerMaps } from '../../maps/browse-server-maps'
import { FilledButton, IconButton, TextButton } from '../../material/button'
import { TextField } from '../../material/text-field'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodySmall, singleLine, titleLarge } from '../../styles/typography'
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

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
`

const FormScroller = styled.div<{ $hidden: boolean }>`
  flex-grow: 1;
  min-height: 0;
  contain: strict;
  overflow-y: auto;

  display: ${props => (props.$hidden ? 'none' : 'block')};
`

const Content = styled.div`
  max-width: 960px;
  margin: 0 auto;
  padding: 16px 24px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const HeaderBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const BrowseColumn = styled.div`
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;

  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
`

const BrowseHeader = styled(HeaderBlock)`
  align-items: flex-start;
  padding: 16px 24px 0;
`

const BrowseArea = styled.div`
  flex-grow: 1;
  min-height: 0;
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

const FooterBar = styled.div<{ $hidden: boolean }>`
  flex-shrink: 0;
  border-top: 1px solid var(--theme-outline-variant);
  background-color: var(--theme-container-low);

  display: ${props => (props.$hidden ? 'none' : 'block')};
`

const FooterContent = styled.div`
  max-width: 960px;
  margin: 0 auto;
  padding: 10px 24px;

  display: flex;
  align-items: center;
  gap: 16px;
`

const SummaryText = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
  flex-grow: 1;
  min-width: 0;
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

/**
 * Returns `recentMaps` with `mapId` guaranteed to be a member, appending it (and evicting the
 * least-recent entry if already at the cap) when it isn't already there. The preferences endpoint
 * rejects a save whose `selectedMap` isn't among its own `recentMaps`, which a map picked through
 * the map browser wouldn't be until a lobby is actually created with it -- the autosave still
 * needs a valid pair before that happens, so it appends rather than leaving the map unsaved.
 */
function ensureMapIncluded(recentMaps: ReadonlyArray<SbMapId>, mapId: SbMapId): SbMapId[] {
  return recentMaps.includes(mapId)
    ? [...recentMaps]
    : [...recentMaps.slice(0, NUM_RECENT_MAPS - 1), mapId]
}

enum MapBrowseState {
  None,
  Server,
  Local,
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
  const [browseState, setBrowseState] = useState(MapBrowseState.None)

  const pick = (mapId: SbMapId) => {
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

  let slots: number | undefined
  if (selectedMapInfo) {
    slots =
      setup.gameType === GameType.UseMapSettings
        ? selectedMapInfo.mapData.umsSlots
        : selectedMapInfo.mapData.slots
  }
  let slotsPart: string | undefined
  if (selectedMapInfo && slots !== undefined) {
    if (setup.gameType === GameType.TopVsBottom) {
      slotsPart = t('lobbies.createLobby.teamSplitOption', {
        defaultValue: '{{top}}v{{bottom}}',
        top: setup.gameSubType,
        bottom: slots - setup.gameSubType,
      })
    } else if (isTeamType(setup.gameType)) {
      slotsPart = t('lobbies.createLobby.gameSubTypeOption', {
        defaultValue: '{{numTeams}} teams',
        numTeams: setup.gameSubType,
      })
    } else if (setup.gameType === GameType.OneVsOne) {
      slotsPart = undefined
    } else {
      slotsPart = t('lobbies.hostGame.summarySlots', {
        defaultValue: '{{count}} slots',
        count: slots,
      })
    }
  }
  const summary = [
    visibility === 'listed'
      ? t('lobbies.createLobby.visibilityListed', 'Public')
      : t('lobbies.createLobby.visibilityUnlisted', 'Unlisted'),
    gameTypeToLabel(setup.gameType, t),
    slotsPart,
    selectedMapInfo?.name,
    setup.allowObservers
      ? t('lobbies.hostGame.summaryObserversOn', 'Observers on')
      : t('lobbies.hostGame.summaryObserversOff', 'No observers'),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Root>
      {browseState !== MapBrowseState.None ? (
        <BrowseColumn>
          <BrowseHeader>
            <TextButton
              label={t('common.actions.back', 'Back')}
              iconStart={<MaterialIcon icon='arrow_back' />}
              onClick={() =>
                setBrowseState(
                  browseState === MapBrowseState.Local
                    ? MapBrowseState.Server
                    : MapBrowseState.None,
                )
              }
            />
            <Title>{t('lobbies.createLobby.selectMap', 'Select map')}</Title>
          </BrowseHeader>
          <BrowseArea>
            {browseState === MapBrowseState.Server ? (
              <BrowseServerMaps
                onMapClick={pick}
                onBrowseLocalMaps={() => setBrowseState(MapBrowseState.Local)}
              />
            ) : (
              <BrowseLocalMaps onMapUpload={pick} />
            )}
          </BrowseArea>
        </BrowseColumn>
      ) : null}

      <FormScroller $hidden={browseState !== MapBrowseState.None}>
        <Content>
          <Header>
            {onNavigateToList ? (
              <IconButton
                icon={<MaterialIcon icon='arrow_back' />}
                title={t('common.actions.back', 'Back')}
                onClick={onNavigateToList}
              />
            ) : null}

            <Title>{t('lobbies.createLobby.title', 'Create lobby')}</Title>
          </Header>

          <GameSetupForm
            ref={formRef}
            disabled={isCreating}
            model={setupModel}
            recentMaps={initial.recentMaps}
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
        </Content>
      </FormScroller>

      <FooterBar $hidden={browseState !== MapBrowseState.None}>
        <FooterContent>
          <SummaryText>{summary}</SummaryText>
          <FilledButton
            label={t('lobbies.createLobby.title', 'Create lobby')}
            disabled={isCreating}
            onClick={() => formRef.current?.submit()}
            testName='create-lobby-submit'
          />
        </FooterContent>
      </FooterBar>
    </Root>
  )
}
