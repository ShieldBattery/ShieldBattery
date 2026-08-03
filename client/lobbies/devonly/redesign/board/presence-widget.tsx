import styled, { css } from 'styled-components'
import { SlotType } from '../../../../../common/lobbies/slot'
import { RaceChar } from '../../../../../common/races'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { OutlinedButton } from '../../../../material/button'
import { elevationPlus2 } from '../../../../material/shadows'
import { zIndexDialogScrim } from '../../../../material/zindex'
import { ContainerLevel, containerStyles, getRaceColor } from '../../../../styles/colors'
import { labelMedium, labelSmall, singleLine, titleSmall } from '../../../../styles/typography'
import { BoardModel, formatElapsed, logBoardAction } from './board-model'

const WidgetArea = styled.div`
  position: fixed;
  right: 300px;
  bottom: 20px;
  z-index: ${zIndexDialogScrim - 1};

  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
`

const WidgetRoot = styled.div`
  ${containerStyles(ContainerLevel.High)};
  ${elevationPlus2};

  width: 248px;
  padding: 8px 12px 12px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  border-radius: 8px;
`

const WidgetTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--theme-on-surface-variant);
`

const WidgetTitle = styled.div`
  ${titleSmall};
  ${singleLine};
  flex-grow: 1;
  min-width: 0;
  color: var(--theme-on-surface);
`

const LifecyclePip = styled.div<{ $tone: 'idle' | 'urgent' | 'live' | 'positive' }>`
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;

  background-color: ${props => {
    switch (props.$tone) {
      case 'urgent':
        return 'var(--theme-amber)'
      case 'live':
        return 'var(--theme-primary)'
      case 'positive':
        return 'var(--theme-positive)'
      default:
        return 'var(--theme-outline)'
    }
  }};
`

const SlotStrip = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
`

const SlotPip = styled.div<{ $race: RaceChar; $state: 'occupied' | 'open' | 'closed' }>`
  width: 10px;
  height: 10px;
  border-radius: 2px;

  ${props => {
    switch (props.$state) {
      case 'occupied':
        return css`
          background-color: ${getRaceColor(props.$race)};
        `
      case 'closed':
        return css`
          background-color: rgb(from var(--theme-on-surface) r g b / 0.24);
        `
      default:
        return css`
          background-color: transparent;
          border: 1px solid var(--theme-outline);
        `
    }
  }};
`

const BenchBadge = styled.div`
  ${labelSmall};
  margin-left: 4px;
  padding-inline: 6px;
  height: 16px;

  display: inline-flex;
  align-items: center;

  border-radius: 8px;
  background-color: rgb(from var(--theme-amber) r g b / 0.16);
  color: var(--theme-amber);
`

const StateLine = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  font-feature-settings: 'tnum' on;
`

const DevCaption = styled.div`
  ${labelSmall};
  padding-inline: 4px;

  color: var(--theme-amber);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

function pipState(slotType: SlotType): 'occupied' | 'open' | 'closed' {
  switch (slotType) {
    case SlotType.Open:
    case SlotType.ControlledOpen:
      return 'open'
    case SlotType.Closed:
    case SlotType.ControlledClosed:
      return 'closed'
    default:
      return 'occupied'
  }
}

function lifecycleTone(model: BoardModel): 'idle' | 'urgent' | 'live' | 'positive' {
  switch (model.lifecycle) {
    case 'countingDown':
      return 'urgent'
    case 'inGame':
      return 'live'
    case 'regroup':
      return 'positive'
    default:
      return 'idle'
  }
}

function stateLine(model: BoardModel): string {
  switch (model.lifecycle) {
    case 'countingDown':
      return `Starting in ${model.data.countdownTimer ?? 0}`
    case 'inGame':
      return `In game · ${formatElapsed(model.data.runState?.elapsedMs ?? 0)}`
    case 'regroup':
      return 'Game over · regrouping'
    default:
      return `Gathering · ${model.takenSeatCount}/${model.seatCount} seats`
  }
}

/**
 * The Board variant's answer to presence elsewhere in the app (Q2): the lobby stays a place you
 * travel to, and a floating widget follows you around with just enough of it — who's seated, what
 * the lobby is doing, and the way back.
 */
export function PresenceWidget({ model }: { model: BoardModel }) {
  return (
    <WidgetArea>
      <WidgetRoot>
        <WidgetTitleRow>
          <MaterialIcon icon='drag_indicator' size={20} />
          <WidgetTitle>{model.lobby.name}</WidgetTitle>
          <LifecyclePip $tone={lifecycleTone(model)} />
        </WidgetTitleRow>
        <SlotStrip>
          {model.seats.map(slot => (
            <SlotPip key={slot.id} $state={pipState(slot.type)} $race={slot.race} />
          ))}
          {model.lobby.bench.length > 0 ? (
            <BenchBadge>{`+${model.lobby.bench.length} bench`}</BenchBadge>
          ) : null}
        </SlotStrip>
        <StateLine>{stateLine(model)}</StateLine>
        <OutlinedButton
          label='Return to lobby'
          iconStart={<MaterialIcon icon='arrow_forward' size={20} />}
          onClick={() => logBoardAction('returnToLobby', model.lobby.id)}
        />
      </WidgetRoot>
      <DevCaption>Presence when navigating away</DevCaption>
    </WidgetArea>
  )
}
