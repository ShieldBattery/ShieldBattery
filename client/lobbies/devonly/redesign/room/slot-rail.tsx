import { useState } from 'react'
import styled, { css } from 'styled-components'
import { assertUnreachable } from '../../../../../common/assert-unreachable'
import { BenchedUser, Lobby, Team } from '../../../../../common/lobbies'
import { Slot, SlotType } from '../../../../../common/lobbies/slot'
import { ConnectedAvatar } from '../../../../avatars/avatar'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { IconButton } from '../../../../material/button'
import { ContainerLevel, containerStyles } from '../../../../styles/colors'
import {
  labelMedium,
  labelSmall,
  singleLine,
  titleSmall,
  titleTiny,
} from '../../../../styles/typography'
import { ConnectedUsername } from '../../../../users/connected-username'
import { RaceIcon } from '../../../race-icon'
import { ScenarioData } from '../mock-data'
import {
  formatWaitTime,
  getRoomLifecycle,
  getSeatCounts,
  getSeatOccupancies,
  RoomViewer,
  SeatOccupancy,
} from './room-model'

const EXPANDED_WIDTH = '296px'
const COLLAPSED_WIDTH = '56px'

const Rail = styled.div<{ $collapsed: boolean }>`
  ${containerStyles(ContainerLevel.Low)};

  width: ${props => (props.$collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH)};
  flex-shrink: 0;

  display: flex;
  flex-direction: column;

  border-left: 1px solid var(--theme-outline-variant);
`

const RailHeader = styled.div<{ $collapsed: boolean }>`
  height: 56px;
  flex-shrink: 0;
  padding-inline: ${props => (props.$collapsed ? '4px' : '8px 4px')};

  display: flex;
  align-items: center;
  gap: 4px;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const RailTitle = styled.div`
  ${titleSmall};

  flex-grow: 1;
  padding-left: 8px;
`

const RailCount = styled.div`
  ${labelMedium};

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const RailBody = styled.div`
  flex-grow: 1;
  min-height: 0;
  padding-block: 8px;

  overflow-y: auto;
`

const CollapsedStrip = styled.div`
  flex-grow: 1;
  padding-block: 12px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
`

const CollapsedPip = styled.div<{ $occupancy: SeatOccupancy }>`
  width: 20px;
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

const CollapsedCount = styled.div`
  ${labelSmall};

  margin-top: 4px;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const SectionLabel = styled.div`
  ${labelSmall};

  padding: 12px 12px 4px;

  display: flex;
  align-items: center;
  gap: 6px;

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const SectionCount = styled.span`
  margin-left: auto;

  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  text-transform: none;
`

const Row = styled.div<{ $isSelf?: boolean; $muted?: boolean; $clickable?: boolean }>`
  height: 40px;
  padding-inline: 12px 4px;

  display: flex;
  align-items: center;
  gap: 8px;

  cursor: ${props => (props.$clickable ? 'pointer' : 'default')};
  opacity: ${props => (props.$muted ? 0.55 : 1)};

  ${props =>
    props.$isSelf
      ? css`
          background-color: rgb(from var(--theme-amber) r g b / 0.12);
          box-shadow: inset 3px 0 0 0 var(--theme-amber);
        `
      : css``}

  &:hover {
    background-color: ${props =>
      props.$isSelf
        ? 'rgb(from var(--theme-amber) r g b / 0.18)'
        : 'rgb(from var(--theme-on-surface) r g b / 0.06)'};
  }
`

const RowAvatar = styled(ConnectedAvatar)`
  width: 28px;
  height: 28px;
  flex-shrink: 0;
`

const EmptyAvatar = styled.div<{ $closed?: boolean }>`
  width: 28px;
  height: 28px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px ${props => (props.$closed ? 'solid' : 'dashed')} var(--theme-outline);
  border-radius: 50%;
  color: var(--theme-on-surface-variant);
`

const RowName = styled.div`
  ${titleSmall};
  ${singleLine};

  flex-grow: 1;
  min-width: 0;
`

const EmptyName = styled(RowName)`
  color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
`

const RowRaceIcon = styled(RaceIcon)`
  width: 20px;
  height: 20px;
  flex-shrink: 0;

  fill: currentColor;
`

const HostMark = styled(MaterialIcon)`
  flex-shrink: 0;

  color: var(--theme-amber);
`

const InGameMark = styled(MaterialIcon)`
  flex-shrink: 0;

  color: var(--theme-positive);
`

const SelfTag = styled.div`
  ${titleTiny};

  flex-shrink: 0;
  padding-inline: 6px;

  background-color: rgb(from var(--theme-amber) r g b / 0.2);
  border-radius: 8px;
  color: var(--theme-amber);
`

const WaitTag = styled.div`
  ${labelSmall};

  flex-shrink: 0;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const SitAction = styled.div`
  ${labelSmall};

  flex-shrink: 0;
  padding-inline: 8px;
  height: 24px;

  display: flex;
  align-items: center;
  gap: 4px;

  border: 1px solid var(--theme-primary);
  border-radius: 12px;
  color: var(--theme-primary);
`

const RowMenuButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  flex-shrink: 0;
`

/** Holds a row's trailing menu column open for viewers who have no actions there. */
const RowMenuSpacer = styled.div`
  width: 32px;
  flex-shrink: 0;
`

function SlotMenuButton({ label }: { label: string }) {
  return (
    <RowMenuButton
      icon={<MaterialIcon icon='more_vert' size={20} />}
      title={label}
      ariaLabel={label}
      onClick={() => console.log(label)}
    />
  )
}

function OccupiedRow({
  slot,
  lobby,
  data,
  viewer,
  hostActions,
}: {
  slot: Slot
  lobby: Lobby
  data: ScenarioData
  viewer: RoomViewer
  hostActions: boolean
}) {
  const isSelf = slot.userId === viewer.userId
  const isLobbyHost = slot.id === lobby.host.id
  const isComputer = slot.type === SlotType.Computer || slot.type === SlotType.UmsComputer

  // While a game is running, the rail is the answer to "who's still in it" -- anyone the run state
  // doesn't list has already dropped back into the room.
  const inGameUsers = data.runState ? new Set(data.runState.inGameUsers) : undefined
  const isInGame = !!(inGameUsers && slot.userId !== undefined && inGameUsers.has(slot.userId))
  const hasLeftGame = !!inGameUsers && !isInGame

  return (
    <Row $isSelf={isSelf} $muted={hasLeftGame}>
      {slot.userId !== undefined ? (
        <RowAvatar userId={slot.userId} />
      ) : (
        <EmptyAvatar $closed={true}>
          <MaterialIcon icon='smart_toy' size={16} />
        </EmptyAvatar>
      )}
      <RowName>
        {slot.userId !== undefined ? (
          <ConnectedUsername userId={slot.userId} interactive={false} />
        ) : (
          'Computer'
        )}
      </RowName>
      {isLobbyHost ? <HostMark icon='workspace_premium' size={16} /> : null}
      {isInGame ? <InGameMark icon='swords' size={16} /> : null}
      {/* The host crown + accent row already mark the viewer's own seat when they're also the
          host, so the "You" chip would be redundant weight crowding out the name. */}
      {isSelf && !isLobbyHost ? <SelfTag>You</SelfTag> : null}
      <RowRaceIcon race={slot.race} />
      {hostActions && !isSelf ? (
        <SlotMenuButton label={isComputer ? 'Computer actions' : 'Player actions'} />
      ) : (
        <RowMenuSpacer />
      )}
    </Row>
  )
}

function EmptyRow({
  slot,
  canSit,
  hostActions,
}: {
  slot: Slot
  canSit: boolean
  hostActions: boolean
}) {
  const isClosed = slot.type === SlotType.Closed || slot.type === SlotType.ControlledClosed

  return (
    <Row
      $clickable={canSit && !isClosed}
      onClick={canSit && !isClosed ? () => console.log('sit in slot', slot.id) : undefined}>
      <EmptyAvatar $closed={isClosed}>
        <MaterialIcon icon={isClosed ? 'lock' : 'add'} size={16} />
      </EmptyAvatar>
      <EmptyName>{isClosed ? 'Closed' : 'Open'}</EmptyName>
      {canSit && !isClosed ? (
        <SitAction>
          <MaterialIcon icon='event_seat' size={14} />
          Sit here
        </SitAction>
      ) : null}
      <RowRaceIcon race={slot.race} />
      {hostActions ? (
        <SlotMenuButton label={isClosed ? 'Open slot' : 'Close slot'} />
      ) : (
        <RowMenuSpacer />
      )}
    </Row>
  )
}

function TeamSection({
  team,
  lobby,
  data,
  viewer,
  canSit,
  hostActions,
}: {
  team: Team
  lobby: Lobby
  data: ScenarioData
  viewer: RoomViewer
  canSit: boolean
  hostActions: boolean
}) {
  const occupied = team.slots.filter(
    slot =>
      slot.type !== SlotType.Open &&
      slot.type !== SlotType.Closed &&
      slot.type !== SlotType.ControlledOpen &&
      slot.type !== SlotType.ControlledClosed,
  ).length

  return (
    <>
      <SectionLabel>
        {team.isObserver ? <MaterialIcon icon='visibility' size={14} /> : null}
        {team.isObserver ? 'Watching' : team.name}
        <SectionCount>
          {occupied}/{team.slots.length}
        </SectionCount>
      </SectionLabel>
      {team.slots.map(slot =>
        slot.type === SlotType.Open ||
        slot.type === SlotType.Closed ||
        slot.type === SlotType.ControlledOpen ||
        slot.type === SlotType.ControlledClosed ? (
          <EmptyRow key={slot.id} slot={slot} canSit={canSit} hostActions={hostActions} />
        ) : (
          <OccupiedRow
            key={slot.id}
            slot={slot}
            lobby={lobby}
            data={data}
            viewer={viewer}
            hostActions={hostActions}
          />
        ),
      )}
    </>
  )
}

function BenchRow({
  benched,
  viewer,
  hostActions,
}: {
  benched: BenchedUser
  viewer: RoomViewer
  hostActions: boolean
}) {
  const isSelf = benched.userId === viewer.userId

  return (
    <Row $isSelf={isSelf}>
      <RowAvatar userId={benched.userId} />
      <RowName>
        <ConnectedUsername userId={benched.userId} interactive={false} />
      </RowName>
      {isSelf ? <SelfTag>You</SelfTag> : <WaitTag>{formatWaitTime(benched.joinedAt)}</WaitTag>}
      <RowRaceIcon race={benched.race} />
      {hostActions && !isSelf ? <SlotMenuButton label='Bench actions' /> : <RowMenuSpacer />}
    </Row>
  )
}

/**
 * The room's slot board, kept to a rail so chat stays the centerpiece. It answers three questions in
 * one column: who holds which seat, which seats a newcomer could take, and who's waiting for one.
 * It collapses to a strip of seat pips for anyone who'd rather have the width for conversation.
 */
export function SlotRail({ data, viewer }: { data: ScenarioData; viewer: RoomViewer }) {
  const [collapsed, setCollapsed] = useState(false)
  const lobby = data.lobby
  const { filled, total } = getSeatCounts(lobby)
  const lifecycle = getRoomLifecycle(data)
  const isGathering = lifecycle === 'gathering' || lifecycle === 'regroup'
  // Sitting down is only meaningful for someone who has no seat, and only while the lobby isn't
  // mid-launch or mid-game.
  const canSit = viewer.isBenched && isGathering
  // The slot layout isn't the host's to rearrange once the lobby has committed to launching: the
  // players it describes are off loading or playing, not sitting in it.
  const hostActions = viewer.isHost && isGathering

  if (collapsed) {
    return (
      <Rail $collapsed={true}>
        <RailHeader $collapsed={true}>
          <IconButton
            icon={<MaterialIcon icon='chevron_left' />}
            title='Expand slots'
            ariaLabel='Expand slots'
            onClick={() => setCollapsed(false)}
          />
        </RailHeader>
        <CollapsedStrip>
          {getSeatOccupancies(lobby).map((occupancy, i) => (
            <CollapsedPip key={i} $occupancy={occupancy} />
          ))}
          <CollapsedCount>
            {filled}/{total}
          </CollapsedCount>
          {lobby.bench.length > 0 ? (
            <>
              <MaterialIcon icon='event_seat' size={16} />
              <CollapsedCount>{lobby.bench.length}</CollapsedCount>
            </>
          ) : null}
        </CollapsedStrip>
      </Rail>
    )
  }

  return (
    <Rail $collapsed={false}>
      <RailHeader $collapsed={false}>
        <RailTitle>Slots</RailTitle>
        <RailCount>
          {filled}/{total}
        </RailCount>
        <IconButton
          icon={<MaterialIcon icon='chevron_right' />}
          title='Collapse slots'
          ariaLabel='Collapse slots'
          onClick={() => setCollapsed(true)}
        />
      </RailHeader>
      <RailBody>
        {lobby.teams.map(team => (
          <TeamSection
            key={team.teamId}
            team={team}
            lobby={lobby}
            data={data}
            viewer={viewer}
            canSit={canSit}
            hostActions={hostActions}
          />
        ))}
        {lobby.bench.length > 0 ? (
          <>
            <SectionLabel>
              <MaterialIcon icon='event_seat' size={14} />
              Waiting for a seat
              <SectionCount>{lobby.bench.length}</SectionCount>
            </SectionLabel>
            {lobby.bench.map(benched => (
              <BenchRow
                key={benched.userId}
                benched={benched}
                viewer={viewer}
                hostActions={hostActions}
              />
            ))}
          </>
        ) : null}
      </RailBody>
    </Rail>
  )
}
