import * as React from 'react'
import { useState } from 'react'
import styled from 'styled-components'
import {
  BestOfHostResult,
  BestOfSideIndex,
  LobbyBestOfJson,
} from '../../../common/lobbies/lobby-best-of'
import {
  GetRememberedBestOfDisplayNamesResponse,
  GetRememberedBestOfOverlayResponse,
} from '../../../common/lobbies/lobby-network'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import { RequestHandlingSpec } from '../../network/abortable-thunk'
import { useAppSelector } from '../../redux-hooks'
import { StartBestOfParams, UpdateBestOfParams } from '../action-creators'
import { RoomChat } from './room-chat'
import { RoomGameSetup } from './room-game-setup'
import { RoomHeader } from './room-header'
import { RoomMapBanner } from './room-map-banner'
import { TeamArrangement } from './room-parts'
import { RoomRail, SlotAction } from './room-rail'
import { RoomSeriesSetup } from './room-series-setup'

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

/** A page that takes over the whole room while it's open. */
type RoomPage = 'gameSetup' | 'series'

export interface LobbyRoomProps {
  /** The member whose point of view the room is rendered from. */
  viewerId: SbUserId
  onSendChatMessage: (msg: string, onError: (err: Error) => void) => void
  onSetRace: (slotId: string, race: RaceChar) => void
  onSitInSlot: (slotId: string) => void
  onMoveSlot: (fromSlotId: string, toSlotId: string) => void
  onLeaveLobby: () => void
  onToggleReady: () => void
  onStartGame: () => void
  onForceStart: () => void
  onCancelCountdown: () => void
  onSlotAction: (action: SlotAction, slotId: string) => void
  onRetryMapDownload: () => void
  onArrangeTeams: (arrangement: TeamArrangement) => void
  onStartBestOf: (request: StartBestOfParams, spec: RequestHandlingSpec<void>) => void
  onUpdateBestOf: (request: UpdateBestOfParams, spec: RequestHandlingSpec<void>) => void
  onEndBestOf: () => void
  /** Loads the caster overlay the viewer's last best-of series was started or saved with. */
  onLoadRememberedBestOfOverlay: (
    spec: RequestHandlingSpec<GetRememberedBestOfOverlayResponse>,
  ) => void
  /** Loads the display names the viewer last gave the given people in a best-of series. */
  onLoadRememberedBestOfDisplayNames: (
    userIds: ReadonlyArray<SbUserId>,
    spec: RequestHandlingSpec<GetRememberedBestOfDisplayNamesResponse>,
  ) => void
  onDiscardBestOfGame: (gameId: string) => void
  /** Sets the result of a game of the lobby's latest best-of series, answering with the series. */
  onSetBestOfGameResult: (
    gameId: string,
    result: BestOfHostResult,
    spec: RequestHandlingSpec<LobbyBestOfJson>,
  ) => void
  /** Adds a win for a side to the lobby's latest best-of series, answering with the series. */
  onAddBestOfResult: (winner: BestOfSideIndex, spec: RequestHandlingSpec<LobbyBestOfJson>) => void
  /** Removes a hand-added result from the lobby's latest best-of series, answering with it. */
  onRemoveBestOfResult: (resultId: string, spec: RequestHandlingSpec<LobbyBestOfJson>) => void
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}

/**
 * The screen for a lobby you're in: a conversation with the game's setup worked into it, rather
 * than a setup form with a chat box attached. Chat holds the floor, the rail down the right side is
 * the seating layout itself, and a finished game lands in the conversation as a card the room can
 * pick its next one out of. The host's game setup and series setup each take over the whole room
 * (they carry their own title/back header) rather than opening as a dialog on top of it.
 */
export function LobbyRoom({
  viewerId,
  onSendChatMessage,
  onSetRace,
  onSitInSlot,
  onMoveSlot,
  onLeaveLobby,
  onToggleReady,
  onStartGame,
  onForceStart,
  onCancelCountdown,
  onSlotAction,
  onRetryMapDownload,
  onArrangeTeams,
  onStartBestOf,
  onUpdateBestOf,
  onEndBestOf,
  onLoadRememberedBestOfOverlay,
  onLoadRememberedBestOfDisplayNames,
  onDiscardBestOfGame,
  onSetBestOfGameResult,
  onAddBestOfResult,
  onRemoveBestOfResult,
  onWatchReplay,
  onViewGameSummary,
}: LobbyRoomProps) {
  const runState = useAppSelector(s => s.lobby.runState)
  const series = useAppSelector(s => s.lobby.series)
  const [openPage, setOpenPage] = useState<RoomPage>()
  // Leaving the series page puts focus back on the banner button that opens it, which unmounted
  // while the page had the room.
  const [isReturningFromSeries, setIsReturningFromSeries] = useState(false)

  const openRoomPage = (page: RoomPage) => {
    setIsReturningFromSeries(false)
    setOpenPage(page)
  }

  // A lobby that has finished a game and isn't in another one is between games, which is a
  // different room than one that has yet to play anything: it has a result to show and seats to
  // reuse rather than fill.
  const isRegrouping = series.length > 0 && !runState

  let content: React.ReactNode
  if (openPage === 'gameSetup') {
    content = <RoomGameSetup onClose={() => setOpenPage(undefined)} />
  } else if (openPage === 'series') {
    content = (
      <RoomSeriesSetup
        onClose={() => {
          setOpenPage(undefined)
          setIsReturningFromSeries(true)
        }}
        onStartBestOf={onStartBestOf}
        onUpdateBestOf={onUpdateBestOf}
        onEndBestOf={onEndBestOf}
        onLoadRememberedOverlay={onLoadRememberedBestOfOverlay}
        onLoadRememberedDisplayNames={onLoadRememberedBestOfDisplayNames}
        onSetBestOfGameResult={onSetBestOfGameResult}
        onAddBestOfResult={onAddBestOfResult}
        onRemoveBestOfResult={onRemoveBestOfResult}
      />
    )
  } else {
    content = (
      <>
        <RoomHeader
          viewerId={viewerId}
          onOpenGameSetup={() => openRoomPage('gameSetup')}
          onLeaveLobby={onLeaveLobby}
        />
        <RoomBody>
          <RoomChat
            viewerId={viewerId}
            isRegrouping={isRegrouping}
            header={
              <RoomMapBanner
                viewerId={viewerId}
                onArrangeTeams={onArrangeTeams}
                onOpenSeriesSetup={() => openRoomPage('series')}
                focusSeriesTool={isReturningFromSeries}
                onEndBestOf={onEndBestOf}
                onDiscardBestOfGame={onDiscardBestOfGame}
                onWatchReplay={onWatchReplay}
                onViewGameSummary={onViewGameSummary}
              />
            }
            aside={
              <RoomRail
                viewerId={viewerId}
                onSetRace={onSetRace}
                onSitInSlot={onSitInSlot}
                onMoveSlot={onMoveSlot}
                onToggleReady={onToggleReady}
                onStartGame={onStartGame}
                onForceStart={onForceStart}
                onCancelCountdown={onCancelCountdown}
                onSlotAction={onSlotAction}
                onRetryMapDownload={onRetryMapDownload}
              />
            }
            onSendChatMessage={onSendChatMessage}
            onWatchReplay={onWatchReplay}
            onViewGameSummary={onViewGameSummary}
          />
        </RoomBody>
      </>
    )
  }

  return <RoomRoot>{content}</RoomRoot>
}
