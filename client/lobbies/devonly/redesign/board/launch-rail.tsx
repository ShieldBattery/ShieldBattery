import styled, { css } from 'styled-components'
import { getLobbySlots } from '../../../../../common/lobbies'
import { SlotType } from '../../../../../common/lobbies/slot'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { FilledButton, OutlinedButton, TextButton } from '../../../../material/button'
import { ContainerLevel, containerStyles } from '../../../../styles/colors'
import {
  bodyMedium,
  displayLarge,
  labelMedium,
  labelSmall,
  titleLarge,
  titleMedium,
} from '../../../../styles/typography'
import { BoardModel, canEditSeats, formatElapsed, logBoardAction, readyTally } from './board-model'

const RailRoot = styled.div`
  width: 300px;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const RailCard = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--theme-outline-variant);

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const RailOverline = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.1em;
`

const RailHeadline = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface);
`

const RailBody = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const CountdownNumeral = styled.div<{ $tone: 'calm' | 'warning' | 'urgent' }>`
  ${displayLarge};
  font-size: 88px;
  line-height: 92px;

  text-align: center;
  font-feature-settings: 'tnum' on;

  color: ${props => {
    switch (props.$tone) {
      case 'urgent':
        return 'var(--theme-negative)'
      case 'warning':
        return 'var(--theme-amber)'
      default:
        return 'var(--color-blue80)'
    }
  }};
`

const ElapsedReadout = styled.div`
  ${titleLarge};
  font-feature-settings: 'tnum' on;
  color: var(--theme-on-surface);
`

const PipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const MiniPip = styled.div<{ $ready: boolean; $reset: boolean }>`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid;

  ${props => {
    if (props.$ready) {
      return css`
        border-color: var(--theme-positive);
        background-color: var(--theme-positive);
      `
    } else if (props.$reset) {
      return css`
        border-color: var(--theme-amber);
        background-color: transparent;
      `
    } else {
      return css`
        border-color: var(--theme-outline);
        background-color: transparent;
      `
    }
  }};
`

const Notice = styled.div<{ $tone: 'amber' | 'neutral' }>`
  ${labelMedium};
  padding: 8px 10px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 8px;

  ${props =>
    props.$tone === 'amber'
      ? css`
          background-color: rgb(from var(--theme-amber) r g b / 0.14);
          color: var(--theme-amber);
        `
      : css`
          background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
          color: var(--theme-on-surface-variant);
        `};
`

const Actions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;

  & > * {
    width: 100%;
  }
`

const RunItBackButton = styled(FilledButton)`
  min-height: 52px;
  background-color: var(--theme-positive);
  color: var(--theme-positive-invert);
`

const SecondaryActions = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
`

const SeriesLine = styled.div`
  ${titleLarge};
  font-feature-settings: 'tnum' on;
  color: var(--theme-on-surface);
`

function countdownTone(secondsLeft: number): 'calm' | 'warning' | 'urgent' {
  if (secondsLeft <= 2) {
    return 'urgent'
  }
  return secondsLeft <= 3 ? 'warning' : 'calm'
}

function ReadySummary({ model }: { model: BoardModel }) {
  const { ready, total } = readyTally(model)
  const seated = getLobbySlots(model.lobby).filter(slot => slot.type === SlotType.Human)

  return (
    <>
      <RailHeadline>{`${ready} of ${total} ready`}</RailHeadline>
      <PipRow>
        {seated.map(slot => (
          <MiniPip
            key={slot.id}
            $ready={model.readyUsers.has(slot.userId!)}
            $reset={model.readinessReset}
          />
        ))}
      </PipRow>
      {model.readinessReset ? (
        <Notice $tone='amber'>
          <MaterialIcon icon='refresh' size={18} />
          Settings changed — everyone has to ready up again
        </Notice>
      ) : null}
    </>
  )
}

function GatheringActions({ model }: { model: BoardModel }) {
  if (model.isBenched) {
    return null
  }

  if (model.startModel === 'countdown') {
    return model.isHost ? (
      <Actions>
        <FilledButton
          label='Start game'
          iconStart={<MaterialIcon icon='play_arrow' size={20} />}
          onClick={() => logBoardAction('startGame')}
        />
      </Actions>
    ) : (
      <RailBody>Waiting for the host to start the game.</RailBody>
    )
  }

  const selfReady = model.readyUsers.has(model.selfUserId)
  return (
    <Actions>
      {selfReady ? (
        <OutlinedButton
          label='Not ready'
          iconStart={<MaterialIcon icon='close' size={20} />}
          onClick={() => logBoardAction('setReady', false)}
        />
      ) : (
        <FilledButton
          label='Ready up'
          iconStart={<MaterialIcon icon='check' size={20} />}
          onClick={() => logBoardAction('setReady', true)}
        />
      )}
      {model.isHost ? (
        <OutlinedButton
          label='Force start'
          iconStart={<MaterialIcon icon='bolt' size={20} />}
          onClick={() => logBoardAction('forceStart')}
        />
      ) : null}
    </Actions>
  )
}

function StatusCard({ model }: { model: BoardModel }) {
  switch (model.lifecycle) {
    case 'countingDown': {
      const secondsLeft = model.data.countdownTimer ?? 0
      return (
        <RailCard>
          <RailOverline>Launching</RailOverline>
          {model.startModel === 'countdown' ? (
            <>
              <CountdownNumeral $tone={countdownTone(secondsLeft)}>{secondsLeft}</CountdownNumeral>
              <RailBody>Everyone loads in when this hits zero.</RailBody>
            </>
          ) : (
            <>
              <ReadySummary model={model} />
              <RailBody>Everyone readied up, so the lobby is loading in.</RailBody>
            </>
          )}
          {model.isHost ? (
            <SecondaryActions>
              <TextButton
                label='Cancel'
                iconStart={<MaterialIcon icon='close' size={20} />}
                onClick={() => logBoardAction('cancelCountdown')}
              />
            </SecondaryActions>
          ) : null}
        </RailCard>
      )
    }

    case 'inGame': {
      const stillPlaying = model.inGameUsers.size
      return (
        <RailCard>
          <RailOverline>In game</RailOverline>
          <ElapsedReadout>{formatElapsed(model.data.runState?.elapsedMs ?? 0)}</ElapsedReadout>
          <RailBody>{`${stillPlaying} of ${model.takenSeatCount} still playing.`}</RailBody>
          <Notice $tone='neutral'>
            <MaterialIcon icon='chat' size={18} />
            Chat stays open for everyone waiting it out
          </Notice>
        </RailCard>
      )
    }

    case 'regroup': {
      const [ours, theirs] = model.data.seriesScore ?? [0, 0]
      return (
        <RailCard>
          <RailOverline>Regroup</RailOverline>
          <RailHeadline>Same seats, same races</RailHeadline>
          <SeriesLine>{`Series ${ours} — ${theirs}`}</SeriesLine>
          <Actions>
            {model.isHost ? (
              <RunItBackButton
                label='Run it back'
                iconStart={<MaterialIcon icon='replay' size={20} />}
                onClick={() => logBoardAction('runItBack')}
              />
            ) : (
              <RailBody>Waiting for the host to run it back.</RailBody>
            )}
            <TextButton
              label='View full results'
              iconStart={<MaterialIcon icon='scoreboard' size={20} />}
              onClick={() => logBoardAction('viewGameResults')}
            />
          </Actions>
        </RailCard>
      )
    }

    default:
      return (
        <RailCard>
          <RailOverline>Gathering</RailOverline>
          {model.startModel === 'readyChecks' ? (
            <ReadySummary model={model} />
          ) : (
            <RailHeadline>{`${model.takenSeatCount} of ${model.seatCount} seats filled`}</RailHeadline>
          )}
          <GatheringActions model={model} />
        </RailCard>
      )
  }
}

function BenchNotice({ model }: { model: BoardModel }) {
  const place = model.lobby.bench.findIndex(benched => benched.userId === model.selfUserId)

  return (
    <RailCard>
      <RailOverline>Your spot</RailOverline>
      <RailHeadline>{place === 0 ? 'Next in line' : `#${place + 1} in line`}</RailHeadline>
      <RailBody>
        You're a full member of this lobby — you just don't have a seat yet. Take any open seat, or
        wait for one to free up.
      </RailBody>
      <SecondaryActions>
        <TextButton
          label='Leave the bench'
          iconStart={<MaterialIcon icon='logout' size={20} />}
          onClick={() => logBoardAction('leaveBench')}
        />
      </SecondaryActions>
    </RailCard>
  )
}

/**
 * Whether "Leave lobby" belongs in the secondary-actions card for this viewer: it's redundant with
 * the bench's own exit action while benched, and once the lobby is mid-launch or already running,
 * it isn't a place any viewer is actively managing themselves out of through this panel.
 */
function canLeaveViaSecondaryActions(model: BoardModel): boolean {
  return canEditSeats(model) && !model.isBenched
}

/**
 * The board's control column: what the lobby is doing right now, and the one action the viewer can
 * take about it. Kept beside the seats rather than under them so the primary action never scrolls
 * out from under a full board.
 */
export function LaunchRail({ model }: { model: BoardModel }) {
  const showLobbySettings = model.isHost && canEditSeats(model)
  const showLeaveLobby = canLeaveViaSecondaryActions(model)

  return (
    <RailRoot>
      <StatusCard model={model} />
      {model.isBenched ? <BenchNotice model={model} /> : null}
      {showLobbySettings || showLeaveLobby ? (
        <RailCard>
          <SecondaryActions>
            {showLobbySettings ? (
              <TextButton
                label='Lobby settings'
                iconStart={<MaterialIcon icon='settings' size={20} />}
                onClick={() => logBoardAction('openLobbySettings')}
              />
            ) : null}
            {showLeaveLobby ? (
              <TextButton
                label='Leave lobby'
                iconStart={<MaterialIcon icon='exit_to_app' size={20} />}
                onClick={() => logBoardAction('leaveLobby')}
              />
            ) : null}
          </SecondaryActions>
        </RailCard>
      ) : null}
    </RailRoot>
  )
}
