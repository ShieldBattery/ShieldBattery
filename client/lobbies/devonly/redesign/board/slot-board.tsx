import { Fragment } from 'react'
import styled from 'styled-components'
import { BenchedUser, hasObservers, Team } from '../../../../../common/lobbies'
import { Slot, SlotType } from '../../../../../common/lobbies/slot'
import { ConnectedAvatar } from '../../../../avatars/avatar'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { TextButton } from '../../../../material/button'
import { ContainerLevel, containerStyles } from '../../../../styles/colors'
import { styledWithAttrs } from '../../../../styles/styled-with-attrs'
import {
  labelMedium,
  labelSmall,
  singleLine,
  titleMedium,
  titleSmall,
} from '../../../../styles/typography'
import { ConnectedUsername } from '../../../../users/connected-username'
import { RaceIcon } from '../../../race-icon'
import { SlotActions } from '../../../slot-actions'
import {
  BoardModel,
  canEditSeats,
  formatWaiting,
  launchProgressForSeat,
  logBoardAction,
} from './board-model'
import { ClosedSeatCard, OpenSeatCard, SeatCard } from './slot-card'

const BoardRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const TeamsRow = styled.div`
  display: flex;
  align-items: stretch;
  gap: 12px;
`

const TeamPanel = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  flex: 1 1 300px;
  min-width: 0;
  padding: 12px;

  border-radius: 12px;
  border: 1px solid var(--theme-outline-variant);
`

const TeamHeader = styled.div`
  height: 28px;
  padding-inline: 4px;
  margin-bottom: 8px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const TeamName = styled.div`
  ${titleMedium};
  ${singleLine};
  color: var(--theme-on-surface);
`

const TeamMeta = styled.div`
  ${labelMedium};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  font-feature-settings: 'tnum' on;
`

const Seats = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const VersusRule = styled.div`
  ${labelSmall};
  width: 32px;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;

  color: var(--theme-on-surface-variant);
  letter-spacing: 0.12em;
  text-transform: uppercase;

  &::before,
  &::after {
    content: '';
    flex-grow: 1;
    width: 1px;
    background-color: var(--theme-outline-variant);
  }
`

const StripPanel = styled.div<{ $accent: boolean }>`
  ${containerStyles(ContainerLevel.Low)};

  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--theme-outline-variant);
  border-left: 3px solid
    ${props => (props.$accent ? 'var(--theme-amber)' : 'var(--theme-outline-variant)')};
`

const StripHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const StripTitle = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface);
`

const StripCount = styled.div`
  ${labelSmall};
  height: 20px;
  padding-inline: 8px;

  display: inline-flex;
  align-items: center;

  border-radius: 10px;
  background-color: rgb(from var(--theme-amber) r g b / 0.16);
  color: var(--theme-amber);
`

const StripHint = styled.div`
  ${labelMedium};
  margin-left: auto;
  color: var(--theme-on-surface-variant);
`

const StripIcon = styledWithAttrs(MaterialIcon, { size: 20 })`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const BenchRows = styled.div`
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const BenchRowRoot = styled.div<{ $self: boolean }>`
  height: 48px;
  padding-inline: 8px 4px;
  flex: 1 1 260px;
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 8px;

  background-color: var(--theme-container);
  border: 1px solid
    ${props => (props.$self ? 'rgb(from var(--theme-primary) r g b / 0.7)' : 'transparent')};
  border-radius: 8px;
`

const BenchAvatar = styled(ConnectedAvatar)`
  width: 28px;
  height: 28px;
  flex-shrink: 0;
`

const BenchName = styled.div`
  ${titleSmall};
  ${singleLine};
  flex-grow: 1;
  min-width: 0;
  color: var(--theme-on-surface);
`

const BenchRaceIcon = styled(RaceIcon)`
  width: 20px;
  height: 20px;
  flex-shrink: 0;
`

const NextUpTag = styled.div`
  ${labelSmall};
  flex-shrink: 0;

  color: var(--theme-amber);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const WaitTime = styled.div`
  ${labelMedium};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  font-feature-settings: 'tnum' on;
`

const ActionsSpacer = styled.div`
  width: 48px;
  flex-shrink: 0;
`

const WatchRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

function teamSeatMeta(model: BoardModel, team: Team): string {
  const taken = team.slots.filter(slot => slot.type !== SlotType.Open).length
  if (model.startModel === 'readyChecks' && model.lifecycle === 'gathering') {
    const humans = team.slots.filter(slot => slot.type === SlotType.Human)
    const ready = humans.filter(slot => model.readyUsers.has(slot.userId!)).length
    return `${ready} / ${humans.length} ready`
  }
  return `${taken} / ${team.slots.length}`
}

function SeatForSlot({ model, slot }: { model: BoardModel; slot: Slot }) {
  switch (slot.type) {
    case SlotType.Closed:
    case SlotType.ControlledClosed:
      return <ClosedSeatCard model={model} slot={slot} />
    case SlotType.Open:
    case SlotType.ControlledOpen:
      return <OpenSeatCard model={model} slot={slot} />
    default: {
      const launching = model.lifecycle === 'countingDown'
      return (
        <SeatCard
          model={model}
          slot={slot}
          launchProgress={launching ? launchProgressForSeat(model.seats.indexOf(slot)) : undefined}
        />
      )
    }
  }
}

function BenchRow({
  model,
  benched,
  isNextUp,
}: {
  model: BoardModel
  benched: BenchedUser
  isNextUp: boolean
}) {
  const isSelf = benched.userId === model.selfUserId
  const actions: Array<[string, () => void]> = []
  if (model.isHost && !isSelf) {
    actions.push(['Move to a seat…', () => logBoardAction('seatFromBench', benched.userId)])
    actions.push(['Kick from lobby', () => logBoardAction('kickBenched', benched.userId)])
    actions.push(['Ban from lobby', () => logBoardAction('banBenched', benched.userId)])
  }

  return (
    <BenchRowRoot $self={isSelf}>
      <BenchAvatar userId={benched.userId} />
      <BenchName>
        <ConnectedUsername userId={benched.userId} />
      </BenchName>
      {isSelf ? <NextUpTag>You</NextUpTag> : null}
      {isNextUp ? <NextUpTag>Next up</NextUpTag> : null}
      <BenchRaceIcon race={benched.race} ariaLabel={benched.race} />
      <WaitTime>{formatWaiting(benched.joinedAt)}</WaitTime>
      {actions.length ? <SlotActions slotActions={actions} /> : <ActionsSpacer />}
    </BenchRowRoot>
  )
}

function benchHint(model: BoardModel): string {
  switch (model.lifecycle) {
    case 'inGame':
      return 'Seated when the game ends'
    case 'countingDown':
      return 'Sitting this game out'
    default:
      return 'First in line takes the next seat that opens'
  }
}

/** The bench (D15): its own strip, so waiting for a seat never looks like sitting in one. */
function BenchStrip({ model }: { model: BoardModel }) {
  return (
    <StripPanel $accent={true}>
      <StripHeader>
        <StripIcon icon='hourglass_top' />
        <StripTitle>Waiting for a seat</StripTitle>
        <StripCount>{model.lobby.bench.length}</StripCount>
        <StripHint>{benchHint(model)}</StripHint>
      </StripHeader>
      <BenchRows>
        {model.lobby.bench.map((benched, i) => (
          <BenchRow key={benched.userId} model={model} benched={benched} isNextUp={i === 0} />
        ))}
      </BenchRows>
    </StripPanel>
  )
}

/** The watching role: self-service for members, with the host holding the switch (spec Q6). */
function WatchingStrip({ model }: { model: BoardModel }) {
  const observersOn = hasObservers(model.lobby)
  const canToggle = model.isHost && canEditSeats(model)

  return (
    <StripPanel $accent={false}>
      <WatchRow>
        <StripIcon icon='visibility' />
        <StripTitle>Watching</StripTitle>
        <StripHint>
          {observersOn
            ? 'Anyone can move themselves to a watching slot'
            : 'Observers are off for this lobby'}
        </StripHint>
        {observersOn ? (
          <TextButton label='Watch instead' onClick={() => logBoardAction('makeSelfObserver')} />
        ) : (
          <TextButton
            label='Allow observers'
            disabled={!canToggle}
            onClick={() => logBoardAction('allowObservers')}
          />
        )}
      </WatchRow>
    </StripPanel>
  )
}

/**
 * The board itself: every seat in the lobby, grouped by team, with the bench as its own strip
 * underneath. This is the piece the war room is built around — who is here, which side they're on,
 * and what they're playing, all readable without reading any text.
 */
export function SlotBoard({ model }: { model: BoardModel }) {
  const teams = model.lobby.teams.filter(team => !team.isObserver)

  return (
    <BoardRoot>
      <TeamsRow>
        {teams.map((team, teamIndex) => (
          <Fragment key={team.teamId}>
            {teamIndex > 0 ? <VersusRule>vs</VersusRule> : null}
            <TeamPanel>
              <TeamHeader>
                <TeamName>{team.name}</TeamName>
                <TeamMeta>{teamSeatMeta(model, team)}</TeamMeta>
              </TeamHeader>
              <Seats>
                {team.slots.map(slot => (
                  <SeatForSlot key={slot.id} model={model} slot={slot} />
                ))}
              </Seats>
            </TeamPanel>
          </Fragment>
        ))}
      </TeamsRow>
      {model.lobby.bench.length > 0 ? <BenchStrip model={model} /> : null}
      <WatchingStrip model={model} />
    </BoardRoot>
  )
}
