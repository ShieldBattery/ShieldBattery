import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { openSimpleDialog } from '../../dialogs/action-creators'
import { FilledButton, OutlinedButton, TextButton } from '../../material/button'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { changeLobbySource } from '../action-creators'
import { GameSetupPage, MapBrowseState } from '../create/game-setup-page'
import { useBrowseForReplay } from '../create/replay-lobby-setup'
import { ReplayCard } from '../lobby-replay'

const Content = styled.div`
  max-width: 620px;
  display: flex;
  flex-direction: column;
  gap: 20px;
`

/** Lets the host replace the replay or choose a map in the same lobby. */
export function RoomReplaySetup({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const replay = useAppSelector(s => s.lobby.info.replay)
  const [browseState, setBrowseState] = useState(MapBrowseState.None)
  const [submitting, setSubmitting] = useState(false)
  const browseForReplay = useBrowseForReplay()

  if (!replay) return null

  const changeReplay = () => {
    browseForReplay()
      .then(chosen => {
        if (!chosen) return
        setSubmitting(true)
        dispatch(
          changeLobbySource(chosen.choice, {
            onSuccess: onClose,
            onError: () => {
              setSubmitting(false)
              dispatch(
                openSimpleDialog(
                  t('lobbies.replayLobby.changeFailed', 'Could not choose replay'),
                  t(
                    'lobbies.replayLobby.changeFailedBody',
                    'The lobby could not switch to this replay.',
                  ),
                ),
              )
            },
          }),
        )
      })
      .catch(swallowNonBuiltins)
  }

  return (
    <GameSetupPage
      title={t('lobbies.replayLobby.replaySetup', 'Replay setup')}
      onBack={onClose}
      browseState={browseState}
      onBrowseStateChange={setBrowseState}
      onMapPicked={mapId => {
        setSubmitting(true)
        dispatch(
          changeLobbySource(
            { kind: 'map', mapId },
            {
              onSuccess: onClose,
              onError: () => {
                setSubmitting(false)
                dispatch(
                  openSimpleDialog(
                    t('lobbies.replayLobby.changeFailed', 'Could not choose map'),
                    t(
                      'lobbies.replayLobby.changeMapFailedBody',
                      'The lobby could not switch to this map.',
                    ),
                  ),
                )
              },
            },
          ),
        )
      }}
      summary={[
        t('lobbies.replayLobby.summaryReplay', 'Replay'),
        replay.source.metadata.mapName,
      ].join(' · ')}
      footerActions={<TextButton label={t('common.actions.done', 'Done')} onClick={onClose} />}>
      <Content>
        <ReplayCard
          mapName={replay.source.metadata.mapName}
          durationFrames={replay.source.metadata.durationFrames}
          players={replay.source.metadata.players}
        />
        <FilledButton
          label={t('lobbies.replayLobby.changeReplay', 'Change replay')}
          iconStart='smart_display'
          disabled={submitting}
          onClick={changeReplay}
        />
        <OutlinedButton
          label={t('lobbies.replayLobby.chooseMap', 'Choose Map')}
          iconStart='map'
          disabled={submitting}
          onClick={() => setBrowseState(MapBrowseState.Server)}
        />
      </Content>
    </GameSetupPage>
  )
}
