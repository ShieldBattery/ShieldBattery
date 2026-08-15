import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { findSlotByUserId, Lobby } from '../../../common/lobbies'
import { LobbyChangedSetting, LobbySeriesPlayerJson } from '../../../common/lobbies/lobby-network'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { TransInterpolation } from '../../i18n/i18next'
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

/** Stands in for the trophy on a game with no winner to celebrate. */
const UnresolvedIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
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

const ComputerName = styled(PlayerName)`
  color: var(--theme-on-surface-variant);
`

const VictoryActions = styled.div`
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
`

/** Describes where in the lobby a member is sitting right now, e.g. `Team 2 · Bottom`. */
function seatDescription(lobby: Lobby, userId: SbUserId, t: TFunction): string | undefined {
  const found = findSlotByUserId(lobby, userId)
  if (found.length !== 3) {
    return undefined
  }

  const [teamIndex] = found
  const team = lobby.teams[teamIndex]
  if (team.isObserver) {
    return t('lobbies.room.chat.watching', 'watching')
  }

  const teamLabel = t('game.teamName.number', {
    defaultValue: 'Team {{teamNumber}}',
    teamNumber: teamIndex + 1,
  })
  return team.name ? `${teamLabel} · ${team.name}` : teamLabel
}

/** The card that lands in chat when someone new turns up, so arrivals read as social events. */
function ArrivalCard({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const lobby = useAppSelector(s => s.lobby.info)
  const seat = seatDescription(lobby, userId, t)

  return (
    <JoinCard>
      <MaterialIcon icon='person_add' size={20} />
      <JoinCardText>
        <JoinCardTitle>
          <Trans t={t} i18nKey='lobbies.room.chat.joinedLobby'>
            <Username userId={userId} /> joined the lobby
          </Trans>
        </JoinCardTitle>
        {seat !== undefined ? (
          <JoinCardSeat>
            {t('lobbies.room.chat.seatedOn', 'seated on {{seat}}', { seat })}
          </JoinCardSeat>
        ) : null}
      </JoinCardText>
    </JoinCard>
  )
}

/** A short, human-readable label for a single changed lobby setting, used in a joined list. */
function changedSettingLabel(setting: LobbyChangedSetting, t: TFunction): string {
  switch (setting) {
    case 'name':
      return t('lobbies.messageLayout.settingsChangeName', 'lobby name')
    case 'map':
      return t('lobbies.messageLayout.settingsChangeMap', 'map')
    case 'gameType':
      return t('lobbies.messageLayout.settingsChangeGameType', 'game type')
    case 'gameSubType':
      return t('lobbies.messageLayout.settingsChangeGameSubType', 'teams')
    case 'useLegacyLimits':
      return t('lobbies.messageLayout.settingsChangeUnitLimit', 'unit limit')
    case 'allowObservers':
      return t('lobbies.messageLayout.settingsChangeObservers', 'observers')
    default:
      return assertUnreachable(setting)
  }
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
  changedSettings: ReadonlyArray<LobbyChangedSetting>
}) {
  const { t } = useTranslation()
  const settings = changedSettings.map(setting => changedSettingLabel(setting, t)).join(', ')
  // A rename touches nothing about the game being set up, so it never resets readiness; any other
  // setting can, so its notice calls that out.
  const resetsReady = changedSettings.some(setting => setting !== 'name')

  return (
    <NoticeCard>
      <MaterialIcon icon='tune' size={20} />
      <div>
        <Trans t={t} i18nKey='lobbies.room.chat.settingsChanged'>
          <Username userId={changedBy} /> changed the {{ settings } as TransInterpolation}
        </Trans>
        {resetsReady ? ` · ${t('lobbies.room.chat.readyReset', 'ready reset')}` : ''}
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

/** One player of a finished game's roster: a lobby member, or one of the computers they played. */
function ResultPlayerRow({ player }: { player: LobbySeriesPlayerJson }) {
  const { t } = useTranslation()
  if (player.type === 'computer') {
    return (
      <PlayerRow>
        <PlayerRaceIcon race={player.race} applyRaceColor />
        <ComputerName>{t('game.playerName.computer', 'Computer')}</ComputerName>
      </PlayerRow>
    )
  }

  return (
    <PlayerRow>
      <PlayerAvatar userId={player.userId} />
      <PlayerRaceIcon race={player.race} applyRaceColor />
      <PlayerName>
        <ConnectedUsername userId={player.userId} UserMenu={LobbyUserMenu} />
      </PlayerName>
    </PlayerRow>
  )
}

/**
 * The result of a finished game, dropped into the conversation it happened in the middle of. The
 * newest one opens itself while the lobby is between games, since that's when its contents are what
 * the room is actually doing; anything the reader opens or closes by hand stays that way.
 */
function GameSummaryCard({ gameId }: { gameId: string }) {
  const { t } = useTranslation()
  const { isRegrouping, onWatchReplay, onViewGameSummary } = React.useContext(GameSummaryContext)
  const series = useAppSelector(s => s.lobby.series)
  const gameIndex = series.findIndex(g => g.gameId === gameId)
  const game = gameIndex >= 0 ? series[gameIndex] : undefined
  const isLatest = gameIndex >= 0 && gameIndex === series.length - 1

  const map = useAppSelector(s => (game ? s.maps.byId.get(game.mapId) : undefined))

  const [override, setOverride] = React.useState<boolean | null>(null)
  const expanded = override ?? (isLatest && isRegrouping)

  if (!game) {
    return null
  }

  // A game's results settle some time after it ends, and games that report none never settle at
  // all, so the headline says as much as the lobby actually knows.
  const result = game.result
  const winningTeamIndex = result?.winningTeamIndex
  const gameLabel = t('lobbies.room.series.gameNumber', 'Game {{number}}', {
    number: gameIndex + 1,
  })
  let headline: string
  if (!result) {
    headline = `${gameLabel} — ${t('lobbies.room.series.waitingForResults', 'Waiting for results')}`
  } else {
    const outcome =
      winningTeamIndex !== undefined
        ? t('lobbies.room.series.victoryTeam', 'Victory Team {{number}}', {
            number: winningTeamIndex + 1,
          })
        : t('lobbies.room.series.noRecordedWinner', 'No recorded winner')
    headline = `${gameLabel} — ${outcome} · ${formatGameDuration(result.durationMs)}`
  }

  return (
    <SummaryCardRoot>
      <SummaryToggle type='button' aria-expanded={expanded} onClick={() => setOverride(!expanded)}>
        {winningTeamIndex !== undefined ? (
          <TrophyIcon icon='trophy' size={20} />
        ) : (
          <UnresolvedIcon icon={result ? 'sports_esports' : 'hourglass_empty'} size={20} />
        )}
        <SummaryHeadline>{headline}</SummaryHeadline>
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
                        {t('game.teamName.number', {
                          defaultValue: 'Team {{teamNumber}}',
                          teamNumber: teamIndex + 1,
                        })}
                        {team.name ? ` · ${team.name}` : ''}
                      </span>
                      {teamIndex === winningTeamIndex ? (
                        <TeamHeadingTrophyIcon icon='trophy' size={14} />
                      ) : null}
                    </TeamHeading>
                    {team.players.map((player, playerIndex) => (
                      <ResultPlayerRow key={playerIndex} player={player} />
                    ))}
                  </TeamColumn>
                ))}
              </TeamsRow>
            </ResultDetails>
          </ResultRow>
          <VictoryActions>
            <TextButton
              label={t('lobbies.room.series.watchReplay', 'Watch replay')}
              iconStart={<MaterialIcon icon='play_arrow' />}
              onClick={() => onWatchReplay(gameId)}
            />
            <TextButton
              label={t('lobbies.room.series.fullSummary', 'Full summary')}
              onClick={() => onViewGameSummary(gameId)}
            />
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
  const { t } = useTranslation()
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
          <Trans t={t} i18nKey='lobbies.room.chat.selfJoinLobby'>
            You joined{' '}
            <SystemImportant>{{ lobby: msg.lobby } as TransInterpolation}</SystemImportant>. The
            host is <Username userId={msg.hostId} />.
          </Trans>
        </SystemMessage>
      )
    case LobbyMessageType.LeaveLobby:
      return (
        <SystemMessage time={msg.time}>
          <Trans t={t} i18nKey='lobbies.room.chat.leftLobby'>
            <Username userId={msg.userId} /> left the lobby
          </Trans>
        </SystemMessage>
      )
    case LobbyMessageType.KickLobbyPlayer:
      return (
        <SystemMessage time={msg.time}>
          <Trans t={t} i18nKey='lobbies.room.chat.wasKicked'>
            <Username userId={msg.userId} /> was kicked
          </Trans>
        </SystemMessage>
      )
    case LobbyMessageType.BanLobbyPlayer:
      return (
        <SystemMessage time={msg.time}>
          <Trans t={t} i18nKey='lobbies.room.chat.wasBanned'>
            <Username userId={msg.userId} /> was banned
          </Trans>
        </SystemMessage>
      )
    case LobbyMessageType.LobbyHostChange:
      return (
        <SystemMessage time={msg.time}>
          <Trans t={t} i18nKey='lobbies.room.chat.isNowHost'>
            <Username userId={msg.userId} /> is now the host
          </Trans>
        </SystemMessage>
      )
    case LobbyMessageType.LobbyBenchJoin:
      return (
        <SystemMessage time={msg.time}>
          <Trans t={t} i18nKey='lobbies.room.chat.waitingForSeat'>
            <Username userId={msg.userId} /> is waiting for a seat
          </Trans>
        </SystemMessage>
      )
    case LobbyMessageType.LobbyCountdownStarted:
      return (
        <SystemMessage time={msg.time}>
          {t('lobbies.room.chat.countdownStarted', 'The game is starting')}
        </SystemMessage>
      )
    case LobbyMessageType.LobbyCountdownTick:
      return <SystemMessage time={msg.time}>{msg.timeLeft}…</SystemMessage>
    case LobbyMessageType.LobbyCountdownCanceled:
      return (
        <SystemMessage time={msg.time}>
          {t('lobbies.room.chat.countdownCanceled', 'The countdown was canceled')}
        </SystemMessage>
      )
    case LobbyMessageType.LobbyLoadingCanceled:
      // Naming who failed to load is the difference between a lobby that looks broken and one whose
      // members can see what to do about it, so the culprits are called out whenever they're known.
      // The prefix and suffix are translated separately from the user list between them, since the
      // list's length varies and can't be represented as fixed positional children of a single key.
      return (
        <SystemMessage time={msg.time}>
          {msg.usersAtFault?.length ? (
            <>
              {t('lobbies.room.chat.loadFailedPrefix', "The game couldn't start because")}{' '}
              {msg.usersAtFault.map((userId, i) => (
                <React.Fragment key={userId}>
                  {i > 0 ? ', ' : ''}
                  <Username userId={userId} />
                </React.Fragment>
              ))}{' '}
              {t('lobbies.room.chat.loadFailedSuffix', 'failed to load')}
            </>
          ) : (
            t('lobbies.room.chat.loadFailedNoUsers', "The game couldn't start")
          )}
        </SystemMessage>
      )
    case LobbyMessageType.LobbyGameStarted:
      return (
        <SystemMessage time={msg.time}>
          {t('lobbies.messageLayout.gameStarted', 'The game has started')}
        </SystemMessage>
      )
    case LobbyMessageType.LobbyMemberGameEnded:
      return (
        <SystemMessage time={msg.time}>
          <Trans t={t} i18nKey='lobbies.room.chat.memberBack'>
            <Username userId={msg.userId} /> is back in the lobby
          </Trans>
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
