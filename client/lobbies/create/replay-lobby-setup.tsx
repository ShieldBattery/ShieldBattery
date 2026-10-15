import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep, StructuredCloneable } from 'type-fest'
import { getErrorStack } from '../../../common/errors'
import { TypedIpcRenderer } from '../../../common/ipc'
import { filterColorCodes } from '../../../common/maps'
import { ReplaySessionPlayer } from '../../../common/replay-sessions'
import { openSimpleDialog } from '../../dialogs/action-creators'
import logger from '../../logging/logger'
import { OutlinedButton } from '../../material/button'
import { push } from '../../navigation/routing'
import { useAppDispatch } from '../../redux-hooks'
import { LobbyReplayChoice } from '../action-creators'
import { ReplayCard } from '../lobby-replay'

const ipcRenderer = new TypedIpcRenderer()

/** A replay picked to watch in a new replay lobby, with what's shown about it while hosting. */
export interface ChosenLobbyReplay {
  choice: LobbyReplayChoice
  mapName: string
  /** How long the replay runs, if known. */
  durationFrames?: number
  players: ReadonlyArray<ReplaySessionPlayer>
}

/** Opens the lobby form with a replay selected, keeping a local path out of the URL. */
export function navigateToCreateReplayLobby(replay: ChosenLobbyReplay) {
  push('/play/lobbies/create', { lobbyReplay: replay } as unknown as StructuredCloneable)
}

/** Reads a local replay's header into what the host form shows about it. */
export async function chooseLocalReplay(path: string): Promise<ChosenLobbyReplay> {
  const parsed = await ipcRenderer.invoke('replayParseMetadata', path)
  if (!parsed) {
    throw new Error('Could not read the replay')
  }

  return {
    choice: { kind: 'local', path },
    mapName: filterColorCodes(parsed.headerData.mapName),
    durationFrames: parsed.headerData.frames,
    players: parsed.players
      .filter(
        p =>
          !p.isEmpty && !p.isObserver && (p.playerType === 'human' || p.playerType === 'computer'),
      )
      .map(p => ({ name: p.name, race: p.race, team: p.team })),
  }
}

/**
 * Returns a function that lets the user pick a local replay file, resolving to the chosen replay
 * (or `undefined` if they didn't pick one).
 */
export function useBrowseForReplay(): () => Promise<ChosenLobbyReplay | undefined> {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  return async () => {
    const result = await ipcRenderer.invoke('replaysBrowseForReplay')
    const path = result?.canceled ? undefined : result?.filePaths[0]
    if (!path) {
      return undefined
    }

    try {
      return await chooseLocalReplay(path)
    } catch (err) {
      logger.error(`Error reading replay [${path}]: ${getErrorStack(err)}`)
      dispatch(
        openSimpleDialog(
          t('lobbies.replayLobby.invalidReplayTitle', "Couldn't read that replay"),
          t(
            'lobbies.replayLobby.invalidReplayBody',
            'The selected file may be corrupt, or not be a StarCraft replay.',
          ),
        ),
      )
      return undefined
    }
  }
}

const FullWidthButton = styled(OutlinedButton)`
  width: 100%;
`

/** Offers watching a replay together as the alternative to picking a map to play. */
export function SelectReplayButton({
  disabled,
  onClick,
}: {
  disabled?: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  return (
    <FullWidthButton
      type='button'
      label={t('lobbies.replayLobby.selectReplay', 'Select replay')}
      iconStart='smart_display'
      disabled={disabled}
      onClick={onClick}
      testName='select-replay-button'
    />
  )
}

const Root = styled.div`
  container-type: inline-size;
`

const Columns = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;

  @container (min-width: 720px) {
    flex-direction: row;
    gap: 24px;
    align-items: flex-start;
  }
`

const SettingsColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 28px;
  flex-grow: 1;
  min-width: 0;
`

const ReplayColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  order: -1;

  @container (min-width: 720px) {
    order: 0;
    width: 300px;
    flex-shrink: 0;
  }
`

/**
 * The host form for a replay lobby: what the lobby is called and who can find it, next to the
 * replay it will watch. Takes the place of the game settings once a replay is chosen, since none of
 * them apply to watching one.
 */
export function ReplayLobbySetup({
  replay,
  nameSection,
  visibilitySection,
  disabled,
  onChangeReplay,
  onChooseMap,
}: {
  replay: ReadonlyDeep<ChosenLobbyReplay>
  nameSection: React.ReactNode
  visibilitySection: React.ReactNode
  disabled?: boolean
  onChangeReplay: () => void
  onChooseMap: () => void
}) {
  const { t } = useTranslation()

  return (
    <Root>
      <Columns>
        <SettingsColumn>
          {nameSection}
          {visibilitySection}
        </SettingsColumn>

        <ReplayColumn>
          <ReplayCard
            mapName={replay.mapName}
            durationFrames={replay.durationFrames}
            players={replay.players}>
            <OutlinedButton
              type='button'
              label={t('lobbies.replayLobby.changeReplay', 'Change replay')}
              iconStart='smart_display'
              disabled={disabled}
              onClick={onChangeReplay}
            />
          </ReplayCard>
          <FullWidthButton
            type='button'
            label={t('lobbies.replayLobby.chooseMap', 'Choose Map')}
            iconStart='map'
            disabled={disabled}
            onClick={onChooseMap}
            testName='select-map-button'
          />
        </ReplayColumn>
      </Columns>
    </Root>
  )
}
