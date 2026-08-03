import styled, { css, keyframes } from 'styled-components'
import { assertUnreachable } from '../../../../../common/assert-unreachable'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { elevationPlus1 } from '../../../../material/shadows'
import { ContainerLevel, containerStyles } from '../../../../styles/colors'
import { labelMedium, labelSmall, singleLine, titleSmall } from '../../../../styles/typography'
import { ScenarioData } from '../mock-data'
import {
  formatElapsed,
  getCountdownColor,
  getCountdownUrgency,
  getRoomLifecycle,
  getSeatCounts,
  getSeatOccupancies,
  getUnreadCount,
  RoomLifecycle,
  RoomViewer,
  SeatOccupancy,
} from './room-model'

const breathe = keyframes`
  0% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.15); }
  100% { opacity: 0.4; transform: scale(0.8); }
`

const resultsFlash = keyframes`
  0%, 100% { background-color: rgb(from var(--theme-positive) r g b / 0.14); }
  50% { background-color: rgb(from var(--theme-positive) r g b / 0.32); }
`

/**
 * The color the room wears in each phase of its life: calm blue while it gathers, amber tension on
 * the countdown, a subdued purple while a game runs, and the positive accent when results land.
 */
function lifecycleAccent(lifecycle: RoomLifecycle): string {
  switch (lifecycle) {
    case 'gathering':
      return 'var(--color-blue70)'
    case 'countingDown':
      return 'var(--theme-amber)'
    case 'inGame':
      return 'var(--theme-purple)'
    case 'regroup':
      return 'var(--theme-positive)'
    default:
      return assertUnreachable(lifecycle)
  }
}

const SectionLabel = styled.div`
  ${labelSmall};
  padding-inline: 16px;
  margin: 12px 0 6px;

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const Entry = styled.button<{ $lifecycle: RoomLifecycle }>`
  ${containerStyles(ContainerLevel.High)};
  ${elevationPlus1};

  position: relative;
  width: calc(100% - 16px);
  margin-inline: 8px;
  padding: 10px 12px 10px 16px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  border: none;
  border-radius: 8px;
  color: var(--theme-on-surface);
  cursor: pointer;
  overflow: hidden;
  text-align: left;

  transition: filter 150ms linear;

  &::before {
    position: absolute;
    content: '';
    inset: 0 auto 0 0;
    width: 4px;

    background-color: ${props => lifecycleAccent(props.$lifecycle)};
  }

  &:hover {
    filter: brightness(1.15);
  }
`

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const LobbyName = styled.div`
  ${titleSmall};
  ${singleLine};

  flex-grow: 1;
`

const UnreadBadge = styled.div`
  ${labelSmall};

  min-width: 20px;
  height: 20px;
  padding-inline: 6px;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: var(--theme-primary);
  border-radius: 10px;
  color: var(--theme-on-primary);
  font-variant-numeric: tabular-nums;
`

const PipRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const Pips = styled.div`
  flex-grow: 1;

  display: flex;
  align-items: center;
  gap: 3px;
`

const Pip = styled.div<{ $occupancy: SeatOccupancy }>`
  width: 100%;
  max-width: 14px;
  height: 6px;

  border-radius: 2px;

  ${props => {
    switch (props.$occupancy) {
      case 'filled':
        return css`
          background-color: var(--color-blue70);
        `
      case 'open':
        return css`
          background-color: transparent;
          box-shadow: inset 0 0 0 1px var(--theme-outline);
        `
      case 'closed':
        return css`
          background-color: rgb(from var(--theme-on-surface) r g b / 0.12);
        `
      default:
        return assertUnreachable(props.$occupancy)
    }
  }}
`

const SeatCount = styled.div`
  ${labelMedium};

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const StatusRow = styled.div`
  min-height: 24px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const StatusText = styled.div`
  ${labelMedium};
  ${singleLine};

  flex-grow: 1;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const BreathingDot = styled.div<{ $color: string }>`
  width: 8px;
  height: 8px;
  flex-shrink: 0;

  background-color: ${props => props.$color};
  border-radius: 50%;

  animation: ${breathe} 2.4s ease-in-out infinite;
`

const CountdownPip = styled.div<{ $color: string }>`
  ${titleSmall};

  min-width: 24px;
  height: 24px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: rgb(from ${props => props.$color} r g b / 0.16);
  border-radius: 6px;
  color: ${props => props.$color};
  font-variant-numeric: tabular-nums;
`

const ResultsChip = styled.div`
  ${labelMedium};

  height: 24px;
  padding-inline: 8px;

  display: flex;
  align-items: center;
  gap: 4px;

  border-radius: 12px;
  color: var(--theme-positive);

  animation: ${resultsFlash} 1.8s ease-in-out infinite;
`

const BenchNote = styled.div`
  ${labelSmall};

  padding-top: 2px;

  display: flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-amber);
`

function LifecycleStatus({ data }: { data: ScenarioData }) {
  const lifecycle = getRoomLifecycle(data)

  switch (lifecycle) {
    case 'gathering': {
      const { filled, total } = getSeatCounts(data.lobby)
      const openSeats = total - filled
      return (
        <>
          <BreathingDot $color={lifecycleAccent('gathering')} />
          <StatusText>
            {openSeats > 0 ? `Gathering · ${openSeats} seats open` : 'Gathering · full'}
          </StatusText>
        </>
      )
    }
    case 'countingDown': {
      const secondsLeft = data.countdownTimer ?? 0
      const color = getCountdownColor(getCountdownUrgency(secondsLeft))
      return (
        <>
          <CountdownPip $color={color}>{secondsLeft}</CountdownPip>
          <StatusText>Starting</StatusText>
        </>
      )
    }
    case 'inGame':
      return (
        <>
          <BreathingDot $color={lifecycleAccent('inGame')} />
          <StatusText>In game · {formatElapsed(data.runState?.elapsedMs ?? 0)}</StatusText>
        </>
      )
    case 'regroup':
      return (
        <ResultsChip>
          <MaterialIcon icon='scoreboard' size={16} />
          Results in
        </ResultsChip>
      )
    default:
      return assertUnreachable(lifecycle)
  }
}

/**
 * The lobby as it appears in the app's social sidebar: a first-class entry that keeps a member's
 * room present no matter where else in the app they've navigated. It carries everything a glance
 * needs — who's seated (a pip per seat), where the lobby is in its life, and how much has been said
 * since the viewer last spoke.
 */
export function RoomSidebarEntry({ data, viewer }: { data: ScenarioData; viewer: RoomViewer }) {
  const lifecycle = getRoomLifecycle(data)
  const { filled, total } = getSeatCounts(data.lobby)
  const unread = getUnreadCount(data, viewer.userId)

  return (
    <>
      <SectionLabel>In lobby</SectionLabel>
      <Entry $lifecycle={lifecycle} onClick={() => console.log('open lobby')}>
        <TopRow>
          <LobbyName>{data.lobby.name}</LobbyName>
          {unread > 0 ? <UnreadBadge>{unread}</UnreadBadge> : null}
        </TopRow>
        <PipRow>
          <Pips>
            {getSeatOccupancies(data.lobby).map((occupancy, i) => (
              <Pip key={i} $occupancy={occupancy} />
            ))}
          </Pips>
          <SeatCount>
            {filled}/{total}
          </SeatCount>
        </PipRow>
        <StatusRow>
          <LifecycleStatus data={data} />
        </StatusRow>
        {viewer.isBenched ? (
          <BenchNote>
            <MaterialIcon icon='event_seat' size={14} />
            {viewer.benchPosition === 1
              ? 'On the bench · next up'
              : `On the bench · #${viewer.benchPosition} in line`}
          </BenchNote>
        ) : null}
      </Entry>
    </>
  )
}
