import { useAtomValue } from 'jotai'
import * as React from 'react'
import styled, { css } from 'styled-components'
import { findSlotByUserId, Lobby } from '../../../common/lobbies'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { MaterialIcon } from '../../icons/material/material-icon'
import { ReduxMapThumbnail } from '../../maps/map-thumbnail'
import { TextButton } from '../../material/button'
import { Chat } from '../../messaging/chat'
import { SystemImportant, SystemMessage } from '../../messaging/message-layout'
import { MessageComponentProps } from '../../messaging/message-list'
import { SbMessage } from '../../messaging/message-records'
import { useAppSelector } from '../../redux-hooks'
import { bodyMedium, labelSmall, singleLine } from '../../styles/typography'
import { ConnectedUsername } from '../../users/connected-username'
import { LobbyUserMenu } from '../lobby-menu-items'
import { LobbyMessageType } from '../lobby-message-records'
import { RaceIcon } from '../race-icon'
import { lobbySeriesAtom } from './room-atoms'
import { formatGameDuration, SectionLabel } from './room-parts'

function Username({ userId }: { userId: SbUserId }) {
  return (
    <SystemImportant>
      <ConnectedUsername userId={userId} UserMenu={LobbyUserMenu} />
    </SystemImportant>
  )
}

/**
 * Cards render as block children of the message container, whose hanging-indent trick (see
 * MessageContainer in message-layout.tsx) only makes sense for message text.
 */
const cardIndentReset = css`
  text-indent: 0;
`

const NoticeCard = styled.div`
  ${bodyMedium};
  ${cardIndentReset};
  width: 100%;
  max-width: 420px;
  margin: 4px 0;
  padding: 8px 12px;

  border-radius: 8px;
  background-color: color-mix(in srgb, var(--theme-amber) 8%, transparent);
  color: var(--theme-on-surface);

  display: flex;
  align-items: flex-start;
  gap: 8px;
`

const JoinCard = styled.div`
  ${cardIndentReset};
  width: 100%;
  max-width: 420px;
  margin: 4px 0;
  padding: 8px 12px;

  border-radius: 8px;
  background-color: var(--theme-container-low);

  display: flex;
  align-items: center;
  gap: 10px;
`

const JoinCardText = styled.div`
  display: flex;
  flex-direction: column;
`

const JoinCardTitle = styled.div`
  ${bodyMedium};
`

const JoinCardSeat = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
`

const SummaryCardRoot = styled.div`
  ${cardIndentReset};
  width: 100%;
  max-width: 600px;
  margin: 4px 0;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  background-color: var(--theme-container-low);

  display: flex;
  flex-direction: column;
`

const SummaryToggle = styled.button`
  ${bodyMedium};
  width: 100%;
  padding: 8px 12px;

  display: flex;
  align-items: center;
  gap: 8px;

  border: none;
  border-radius: 8px;
  background: none;
  color: inherit;
  cursor: pointer;
  text-align: left;

  &:hover {
    background-color: var(--theme-container);
  }
`

const SummaryHeadline = styled.div`
  ${singleLine};
  flex-grow: 1;
  min-width: 0;
`

const SummaryBody = styled.div`
  padding: 0 16px 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const TrophyIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const ResultRow = styled.div`
  display: flex;
  gap: 16px;
`

/**
 * Sized by the map's own aspect ratio (squarish for nearly every map). The frame must have a
 * definite height of its own: the thumbnail inside sizes itself with percentage heights, which
 * collapse to zero against an auto-height ancestor.
 */
const ResultMapFrame = styled.div<{ $aspectRatio: number }>`
  width: 160px;
  flex-shrink: 0;
  align-self: flex-start;
  aspect-ratio: ${props => props.$aspectRatio};

  border-radius: 4px;
  overflow: hidden;
`

const ResultDetails = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const TeamsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  min-width: 0;
  flex-grow: 1;
`

const TeamColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
`

const TeamHeading = styled(SectionLabel)`
  padding: 0;

  display: flex;
  align-items: center;
  gap: 6px;
`

const TeamHeadingTrophyIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const PlayerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
`

const PlayerAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
`

const PlayerRaceIcon = styled(RaceIcon)`
  width: 18px;
  height: 18px;
  flex-shrink: 0;
`

const PlayerName = styled.div`
  ${bodyMedium};
  ${singleLine};
  min-width: 0;
`

const VictoryActions = styled.div`
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
`

/** Describes where in the lobby a member is sitting right now, e.g. `Team 2 · Bottom`. */
function seatDescription(lobby: Lobby, userId: SbUserId): string | undefined {
  const found = findSlotByUserId(lobby, userId)
  if (found.length !== 3) {
    return undefined
  }

  const [teamIndex] = found
  const team = lobby.teams[teamIndex]
  if (team.isObserver) {
    return 'watching'
  }

  return team.name ? `Team ${teamIndex + 1} · ${team.name}` : `Team ${teamIndex + 1}`
}

/** The card that lands in chat when someone new turns up, so arrivals read as social events. */
function ArrivalCard({ userId }: { userId: SbUserId }) {
  const lobby = useAppSelector(s => s.lobby.info)
  const seat = seatDescription(lobby, userId)

  return (
    <JoinCard>
      <MaterialIcon icon='person_add' size={20} />
      <JoinCardText>
        <JoinCardTitle>
          <Username userId={userId} /> joined the lobby
        </JoinCardTitle>
        {seat !== undefined ? <JoinCardSeat>seated on {seat}</JoinCardSeat> : null}
      </JoinCardText>
    </JoinCard>
  )
}

const SETTING_LABELS: Record<string, string> = {
  map: 'map',
  gameType: 'game type',
  gameSubType: 'teams',
  useLegacyLimits: 'unit limit',
  allowObservers: 'observers',
}

/**
 * The card announcing that the host retuned something. Settings changes are the one kind of system
 * event that can invalidate a decision someone already made, so they get more weight than a line.
 */
function SettingsNoticeCard({
  changedBy,
  changedSettings,
}: {
  changedBy: SbUserId
  changedSettings: ReadonlyArray<string>
}) {
  const settings = changedSettings.map(setting => SETTING_LABELS[setting] ?? setting).join(', ')

  return (
    <NoticeCard>
      <MaterialIcon icon='tune' size={20} />
      <div>
        <Username userId={changedBy} /> changed the {settings} · ready reset
      </div>
    </NoticeCard>
  )
}

/**
 * Everything a game summary card needs beyond the game itself: who is reading it, whether the lobby
 * is between games, and what it can offer to do. Held in context so the message list's component
 * type stays stable across renders -- swapping it remounts every message in the log.
 */
export interface GameSummaryActions {
  isRegrouping: boolean
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}

const GameSummaryContext = React.createContext<GameSummaryActions>({
  isRegrouping: false,
  onWatchReplay: () => {},
  onViewGameSummary: () => {},
})

/**
 * The result of a finished game, dropped into the conversation it happened in the middle of. The
 * newest one opens itself while the lobby is between games, since that's when its contents are what
 * the room is actually doing; anything the reader opens or closes by hand stays that way.
 */
function GameSummaryCard({ gameId }: { gameId: string }) {
  const { isRegrouping, onWatchReplay, onViewGameSummary } = React.useContext(GameSummaryContext)
  const series = useAtomValue(lobbySeriesAtom)
  const gameIndex = series.findIndex(g => g.gameId === gameId)
  const game = gameIndex >= 0 ? series[gameIndex] : undefined
  const isLatest = gameIndex >= 0 && gameIndex === series.length - 1

  const map = useAppSelector(s => (game ? s.maps.byId.get(game.mapId) : undefined))

  const [override, setOverride] = React.useState<boolean | null>(null)
  const expanded = override ?? (isLatest && isRegrouping)

  if (!game) {
    return null
  }

  const winningTeam = game.winningTeamIndex + 1
  const duration = formatGameDuration(game.durationMs)

  return (
    <SummaryCardRoot>
      <SummaryToggle type='button' aria-expanded={expanded} onClick={() => setOverride(!expanded)}>
        <TrophyIcon icon='trophy' size={20} />
        <SummaryHeadline>
          Game {gameIndex + 1} — Victory Team {winningTeam} · {duration}
        </SummaryHeadline>
        <MaterialIcon icon={expanded ? 'expand_less' : 'expand_more'} size={20} />
      </SummaryToggle>
      {expanded ? (
        <SummaryBody>
          <ResultRow>
            <ResultMapFrame $aspectRatio={map ? map.mapData.width / map.mapData.height : 1}>
              <ReduxMapThumbnail mapId={game.mapId} size={256} showInfoLayer={true} />
            </ResultMapFrame>
            <ResultDetails>
              <TeamsRow>
                {game.teams.map((team, teamIndex) => (
                  <TeamColumn key={teamIndex}>
                    <TeamHeading>
                      <span>
                        Team {teamIndex + 1}
                        {team.name ? ` · ${team.name}` : ''}
                      </span>
                      {teamIndex === game.winningTeamIndex ? (
                        <TeamHeadingTrophyIcon icon='trophy' size={14} />
                      ) : null}
                    </TeamHeading>
                    {team.players.map(player => (
                      <PlayerRow key={player.userId}>
                        <PlayerAvatar userId={player.userId} />
                        <PlayerRaceIcon race={player.race} applyRaceColor />
                        <PlayerName>
                          <ConnectedUsername userId={player.userId} UserMenu={LobbyUserMenu} />
                        </PlayerName>
                      </PlayerRow>
                    ))}
                  </TeamColumn>
                ))}
              </TeamsRow>
            </ResultDetails>
          </ResultRow>
          <VictoryActions>
            <TextButton
              label='Watch replay'
              iconStart={<MaterialIcon icon='play_arrow' />}
              onClick={() => onWatchReplay(gameId)}
            />
            <TextButton label='Full summary' onClick={() => onViewGameSummary(gameId)} />
          </VictoryActions>
        </SummaryBody>
      ) : null}
    </SummaryCardRoot>
  )
}

/**
 * Renders the lobby-specific entries of the room's chat log. Plain messages between people are
 * handled by the message list itself; everything here is the lobby narrating itself.
 */
function RoomChatMessage({ message }: MessageComponentProps) {
  const msg = message as SbMessage & { type: LobbyMessageType }

  switch (msg.type) {
    case LobbyMessageType.JoinLobby:
      return (
        <SystemMessage time={msg.time}>
          <ArrivalCard userId={msg.userId} />
        </SystemMessage>
      )
    case LobbyMessageType.LobbySettingsChange:
      return (
        <SystemMessage time={msg.time}>
          <SettingsNoticeCard changedBy={msg.changedBy} changedSettings={msg.changedSettings} />
        </SystemMessage>
      )
    case LobbyMessageType.LobbyRegroup:
      return (
        <SystemMessage time={msg.time}>
          <GameSummaryCard gameId={msg.gameId} />
        </SystemMessage>
      )
    case LobbyMessageType.SelfJoinLobby:
      return (
        <SystemMessage time={msg.time}>
          You joined <SystemImportant>{msg.lobby}</SystemImportant>. The host is{' '}
          <Username userId={msg.hostId} />.
        </SystemMessage>
      )
    case LobbyMessageType.LeaveLobby:
      return (
        <SystemMessage time={msg.time}>
          <Username userId={msg.userId} /> left the lobby
        </SystemMessage>
      )
    case LobbyMessageType.KickLobbyPlayer:
      return (
        <SystemMessage time={msg.time}>
          <Username userId={msg.userId} /> was kicked
        </SystemMessage>
      )
    case LobbyMessageType.BanLobbyPlayer:
      return (
        <SystemMessage time={msg.time}>
          <Username userId={msg.userId} /> was banned
        </SystemMessage>
      )
    case LobbyMessageType.LobbyHostChange:
      return (
        <SystemMessage time={msg.time}>
          <Username userId={msg.userId} /> is now the host
        </SystemMessage>
      )
    case LobbyMessageType.LobbyBenchJoin:
      return (
        <SystemMessage time={msg.time}>
          <Username userId={msg.userId} /> is waiting for a seat
        </SystemMessage>
      )
    case LobbyMessageType.LobbyCountdownStarted:
      return <SystemMessage time={msg.time}>The game is starting</SystemMessage>
    case LobbyMessageType.LobbyCountdownTick:
      return <SystemMessage time={msg.time}>{msg.timeLeft}…</SystemMessage>
    case LobbyMessageType.LobbyCountdownCanceled:
      return <SystemMessage time={msg.time}>The countdown was canceled</SystemMessage>
    case LobbyMessageType.LobbyLoadingCanceled:
      return <SystemMessage time={msg.time}>The game couldn't start</SystemMessage>
    case LobbyMessageType.LobbyGameStarted:
      return <SystemMessage time={msg.time}>The game has started</SystemMessage>
    case LobbyMessageType.LobbyMemberGameEnded:
      return (
        <SystemMessage time={msg.time}>
          <Username userId={msg.userId} /> is back in the lobby
        </SystemMessage>
      )
    default:
      msg satisfies never
      return null
  }
}

const ChatSurface = styled(Chat)`
  flex-grow: 1;
  min-height: 0;
  /* The base component sizes to its parent; here it fills whatever the room's chat column leaves. */
  height: auto;
`

/** The room's conversation: the widest surface, because it's what a lobby actually does. */
export function RoomChat({
  isRegrouping,
  onSendChatMessage,
  onWatchReplay,
  onViewGameSummary,
}: {
  onSendChatMessage: (msg: string) => void
} & GameSummaryActions) {
  const chat = useAppSelector(s => s.lobby.chat)

  return (
    <GameSummaryContext.Provider
      value={{
        isRegrouping,
        onWatchReplay,
        onViewGameSummary,
      }}>
      <ChatSurface
        listProps={{ messages: chat, MessageComponent: RoomChatMessage }}
        inputProps={{ onSendChatMessage }}
        UserMenu={LobbyUserMenu}
      />
    </GameSummaryContext.Provider>
  )
}
