import { TFunction } from 'i18next'
import { debounce } from 'lodash-es'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { LOBBY_NAME_MAXLENGTH } from '../../../common/constants'
import { GameType, gameTypeToLabel, isTeamType } from '../../../common/games/game-type'
import { LobbyVisibility } from '../../../common/lobbies'
import { SbMapId } from '../../../common/maps'
import { useSelfUser } from '../../auth/auth-utils'
import { openSimpleDialog } from '../../dialogs/action-creators'
import { MaterialIcon } from '../../icons/material/material-icon'
import { ReduxMapThumbnail } from '../../maps/map-thumbnail'
import { FilledButton, TextButton } from '../../material/button'
import { TextField } from '../../material/text-field'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { ContainerLevel, containerStyles } from '../../styles/colors'
import { bodyLarge, bodySmall, labelSmall, singleLine, titleLarge } from '../../styles/typography'
import { createLobby, getLobbyPreferences, updateLobbyPreferences } from '../action-creators'
import { navigateToLobby } from '../lobby-url'
import { GameSetupForm, GameSetupFormHandle, GameSetupModel } from './game-setup-form'
import { VisibilityPicker } from './visibility-picker'

/** The most recent maps kept in the create form's preferences, newest first. */
const NUM_RECENT_MAPS = 5

const Content = styled.div`
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 24px;
`

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
`

const BackButtonRow = styled.div`
  margin-bottom: 8px;
`

const Title = styled.div`
  ${titleLarge};
  margin-bottom: 16px;
`

const HostAgainCard = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 4px;
`

const HostAgainThumbnail = styled(ReduxMapThumbnail)`
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
`

const HostAgainInfo = styled.div`
  flex-grow: 1;
  min-width: 0;
`

const HostAgainOverline = styled.div`
  ${labelSmall};
  color: var(--theme-amber);
  text-transform: uppercase;
`

const HostAgainTitle = styled.div`
  ${bodyLarge};
  ${singleLine};
`

const HostAgainMeta = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const Divider = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 24px 0;
`

const DividerLine = styled.div`
  flex-grow: 1;
  height: 1px;
  background-color: var(--theme-outline-variant);
`

const DividerLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
`

const SectionHeader = styled.div`
  ${bodyLarge};
  margin: 20px 0 8px;
`

const NameSection = styled.div`
  margin-top: 20px;
`

const NameHint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  margin-top: 4px;
`

const VisibilitySection = styled.div`
  margin-top: 20px;
`

const CreateButtonRow = styled.div`
  margin-top: 24px;
`

const FullWidthButton = styled(FilledButton)`
  width: 100%;
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
}

/**
 * The redesigned "Host a game" surface: a quick-recreate card for the last setup, and a form for
 * starting fresh built on the shared `GameSetupForm` core.
 */
export function HostGame({ onNavigateToList }: HostGameProps) {
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

  return <HostGameContent onNavigateToList={onNavigateToList} />
}

function HostGameContent({ onNavigateToList }: HostGameProps) {
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

  // Captured once when this mounts (which only happens once preferences have loaded): the starting
  // point for both the "host again" card and the form below. Later preference changes -- including
  // this component's own autosaves as the form below is edited -- intentionally don't feed back
  // into either, or the "host again" card would drift to reflect an in-progress, unsubmitted edit.
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

  const initialMapInfo = useAppSelector(s =>
    initial.selectedMap ? s.maps.byId.get(initial.selectedMap) : undefined,
  )

  const [isCreating, setIsCreating] = useState(false)
  const [name, setName] = useState(() =>
    initial.name.trim() ? initial.name : defaultLobbyName(t, selfUser?.name),
  )
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

  // A debounced save always fires after whichever render triggered it, so it needs to read
  // whatever `name`/`visibility`/`setup` are by the time it actually runs rather than whatever
  // they were when the debounce was created; `useEffectEvent` gives a stable function that always
  // sees the latest values without that staleness.
  const saveNow = useEffectEvent(() => {
    dispatch(
      updateLobbyPreferences({
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
      }),
    )
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

  const canHostAgain = !!initial.selectedMap && !!initialMapInfo

  const setupModel: GameSetupModel = {
    mapId: initial.selectedMap,
    gameType: initial.gameType,
    gameSubType: initial.gameSubType,
    useLegacyLimits: initial.useLegacyLimits,
    allowObservers: initial.allowObservers,
  }

  return (
    <Content>
      {onNavigateToList ? (
        <BackButtonRow>
          <TextButton
            label={t('lobbies.createLobby.backToList', 'Back to list')}
            iconStart={<MaterialIcon icon='arrow_back' />}
            onClick={onNavigateToList}
          />
        </BackButtonRow>
      ) : null}

      <Title>{t('lobbies.hostGame.title', 'Host a game')}</Title>

      {canHostAgain ? (
        <>
          <HostAgainCard>
            <HostAgainThumbnail mapId={initial.selectedMap!} forceAspectRatio={1} size={256} />
            <HostAgainInfo>
              <HostAgainOverline>{t('lobbies.hostGame.lastSetup', 'Last setup')}</HostAgainOverline>
              <HostAgainTitle>
                {initialMapInfo!.name} · {gameTypeToLabel(initial.gameType, t)}
              </HostAgainTitle>
              <HostAgainMeta>
                {initial.allowObservers
                  ? t('lobbies.hostGame.observersOn', 'observers on')
                  : t('lobbies.hostGame.observersOff', 'observers off')}
                {' · '}
                {initial.visibility === 'listed'
                  ? t('lobbies.createLobby.visibilityListed', 'Public')
                  : t('lobbies.createLobby.visibilityUnlisted', 'Unlisted')}
              </HostAgainMeta>
            </HostAgainInfo>
            <FilledButton
              label={t('lobbies.hostGame.hostAgain', 'Host again')}
              disabled={isCreating}
              onClick={() => {
                const hostAgainName = initial.name.trim()
                  ? initial.name
                  : defaultLobbyName(t, selfUser?.name)

                setIsCreating(true)
                dispatch(
                  createLobby(
                    {
                      name: hostAgainName,
                      map: initial.selectedMap!,
                      gameType: initial.gameType,
                      gameSubType: isTeamType(initial.gameType) ? initial.gameSubType : undefined,
                      useLegacyLimits: initial.useLegacyLimits,
                      allowObservers: initial.allowObservers,
                      visibility: initial.visibility,
                    },
                    {
                      onSuccess: result => navigateToLobby(result.id, hostAgainName),
                      onError: () => {
                        setIsCreating(false)
                        showErrorDialog()
                      },
                    },
                  ),
                )
              }}
            />
          </HostAgainCard>

          <Divider>
            <DividerLine />
            <DividerLabel>{t('lobbies.hostGame.orStartFresh', 'or start fresh')}</DividerLabel>
            <DividerLine />
          </Divider>
        </>
      ) : null}

      <GameSetupForm
        ref={formRef}
        disabled={isCreating}
        model={setupModel}
        recentMapIds={initial.recentMaps}
        onValidatedChange={model => {
          setSetup(model)
          debouncedSaveRef.current?.()
        }}
        onSubmit={model => {
          const finalName = name.trim() ? name.trim() : defaultLobbyName(t, selfUser?.name)

          setIsCreating(true)
          dispatch(
            createLobby(
              {
                name: finalName,
                map: model.mapId!,
                gameType: model.gameType,
                gameSubType: isTeamType(model.gameType) ? model.gameSubType : undefined,
                useLegacyLimits: model.useLegacyLimits,
                allowObservers: model.allowObservers,
                visibility,
              },
              {
                onSuccess: result => navigateToLobby(result.id, finalName),
                onError: () => {
                  setIsCreating(false)
                  showErrorDialog()
                },
              },
            ),
          )

          debouncedSaveRef.current?.cancel()

          dispatch(
            updateLobbyPreferences({
              name: finalName,
              selectedMap: model.mapId,
              recentMaps: updateRecentMaps(model.mapId!, initial.recentMaps),
              gameType: model.gameType,
              gameSubType: model.gameSubType,
              useLegacyLimits: model.useLegacyLimits,
              visibility,
              allowObservers: model.allowObservers,
            }),
          )
        }}
      />

      <NameSection>
        <TextField
          value={name}
          onChange={event => {
            setName(event.target.value)
            debouncedSaveRef.current?.()
          }}
          disabled={isCreating}
          floatingLabel={true}
          label={t('lobbies.createLobby.lobbyName', 'Lobby name')}
          inputProps={{
            maxLength: LOBBY_NAME_MAXLENGTH,
            autoCapitalize: 'off',
            autoComplete: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}
        />
        <NameHint>{t('lobbies.hostGame.nameHint', 'Optional — we picked one for you')}</NameHint>
      </NameSection>

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

      <CreateButtonRow>
        <FullWidthButton
          label={t('lobbies.createLobby.title', 'Create lobby')}
          disabled={isCreating}
          onClick={() => formRef.current?.submit()}
        />
      </CreateButtonRow>
    </Content>
  )
}
