import { useState } from 'react'
import styled from 'styled-components'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import { useAppSelector } from '../../redux-hooks'
import { RoomChat } from './room-chat'
import { RoomGameSetup } from './room-game-setup'
import { RoomHeader } from './room-header'
import { RoomMapBanner } from './room-map-banner'
import { TeamArrangement } from './room-parts'
import { RoomRail, SlotAction } from './room-rail'

const RoomRoot = styled.div`
  width: 100%;
  max-width: 1200px;
  height: 100%;
  margin: 0 auto;

  display: flex;
  flex-direction: column;
`

const RoomBody = styled.div`
  flex-grow: 1;
  min-height: 0;

  display: flex;
`

const ChatColumn = styled.div`
  flex-grow: 1;
  min-width: 0;
  min-height: 0;

  display: flex;
  flex-direction: column;
`

export interface LobbyRoomProps {
  /** The member whose point of view the room is rendered from. */
  viewerId: SbUserId
  onSendChatMessage: (msg: string) => void
  onSetRace: (slotId: string, race: RaceChar) => void
  onSitInSlot: (slotId: string) => void
  onLeaveLobby: () => void
  onToggleReady: () => void
  onStartGame: () => void
  onForceStart: () => void
  onCancelCountdown: () => void
  onSlotAction: (action: SlotAction, slotId: string) => void
  onArrangeTeams: (arrangement: TeamArrangement) => void
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}

/**
 * The screen for a lobby you're in: a conversation with the game's setup worked into it, rather
 * than a setup form with a chat box attached. Chat holds the floor, the rail down the right side is
 * the seating layout itself, and a finished game lands in the conversation as a card the room can
 * pick its next one out of. The host's game setup takes over the whole room (it carries its own
 * title/back header) rather than opening as a dialog on top of it.
 */
export function LobbyRoom({
  viewerId,
  onSendChatMessage,
  onSetRace,
  onSitInSlot,
  onLeaveLobby,
  onToggleReady,
  onStartGame,
  onForceStart,
  onCancelCountdown,
  onSlotAction,
  onArrangeTeams,
  onWatchReplay,
  onViewGameSummary,
}: LobbyRoomProps) {
  const runState = useAppSelector(s => s.lobby.runState)
  const series = useAppSelector(s => s.lobby.series)
  const [isSetupOpen, setIsSetupOpen] = useState(false)

  // A lobby that has finished a game and isn't in another one is between games, which is a
  // different room than one that has yet to play anything: it has a result to show and seats to
  // reuse rather than fill.
  const isRegrouping = series.length > 0 && !runState

  return (
    <RoomRoot>
      {isSetupOpen ? (
        <RoomGameSetup onClose={() => setIsSetupOpen(false)} />
      ) : (
        <>
          <RoomHeader
            viewerId={viewerId}
            onOpenGameSetup={() => setIsSetupOpen(true)}
            onToggleReady={onToggleReady}
            onLeaveLobby={onLeaveLobby}
          />
          <RoomBody>
            <ChatColumn>
              <RoomMapBanner
                viewerId={viewerId}
                onArrangeTeams={onArrangeTeams}
                onWatchReplay={onWatchReplay}
                onViewGameSummary={onViewGameSummary}
              />
              <RoomChat
                isRegrouping={isRegrouping}
                onSendChatMessage={onSendChatMessage}
                onWatchReplay={onWatchReplay}
                onViewGameSummary={onViewGameSummary}
              />
            </ChatColumn>
            <RoomRail
              viewerId={viewerId}
              onSetRace={onSetRace}
              onSitInSlot={onSitInSlot}
              onStartGame={onStartGame}
              onForceStart={onForceStart}
              onCancelCountdown={onCancelCountdown}
              onSlotAction={onSlotAction}
            />
          </RoomBody>
        </>
      )}
    </RoomRoot>
  )
}
