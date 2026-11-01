import type { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import { GameConfig } from '../../common/games/configuration'
import {
  GameDraftMessageJson,
  GameReplayDebugInfo,
  getGameDurationString,
} from '../../common/games/games'
import { ReplayChatPlayer } from '../../common/replays'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { IconButton, OutlinedButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { selectableTextContainer } from '../styles/text-selection'
import { bodyMedium, labelLarge, labelMedium, titleLarge, titleSmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { loadGameChatTranscript } from './action-creators'
import {
  ChatScope,
  ChatTranscript,
  ChatTranscriptLine,
  getChatSides,
  selectChatTranscriptReplays,
} from './chat-transcript'

const Root = styled.div`
  grid-column: 1 / -1;
  width: 100%;
`

const TranscriptCard = styled.div`
  ${containerStyles(ContainerLevel.Normal)};
  margin-top: 16px;
  padding: 16px;
  border-radius: 4px;
`

const TranscriptHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const TranscriptTitle = styled.div`
  ${titleLarge};
  color: var(--theme-on-surface);
`

const SourcesLine = styled.div`
  ${bodyMedium};
  margin-block: 4px 16px;
  color: var(--theme-on-surface-variant);
`

const SegmentTitle = styled.div`
  ${titleSmall};
  margin-block: 16px 8px;
  color: var(--theme-on-surface-variant);
`

const StatusLine = styled.div`
  ${bodyMedium};
  margin-top: 8px;
  color: var(--theme-on-surface-variant);
`

const Lines = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  ${selectableTextContainer};
`

const Line = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface);
  overflow-wrap: anywhere;
`

// Gaps between a line's parts are real spaces rather than margins, so selected and copied text
// keeps them.
const Timestamp = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const Scope = styled.span`
  color: var(--theme-on-surface-variant);
`

const PlayerName = styled.span`
  ${labelLarge};
`

const LeaveText = styled.span`
  color: var(--theme-on-surface-variant);
`

type TranscriptState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; transcript: ChatTranscript }
  | { status: 'error' }

function getScopeLabel(scope: ChatScope, t: TFunction): string {
  switch (scope) {
    case 'all':
      return t('gameDetails.chatTranscript.scopeAll', '(ALL)')
    case 'team':
      return t('gameDetails.chatTranscript.scopeTeam', '(TEAM)')
    case 'unknown':
      return t('gameDetails.chatTranscript.scopeUnknown', '(?)')
    default:
      return scope satisfies never
  }
}

function getPlayerName(
  players: ReadonlyMap<number, ReplayChatPlayer>,
  slotId: number,
  t: TFunction,
): string {
  return (
    players.get(slotId)?.name ??
    t('gameDetails.chatTranscript.unknownSender', 'Slot {{slot}}', { slot: slotId })
  )
}

function getLineSlot(line: ChatTranscriptLine): number {
  return line.kind === 'chat' ? line.senderSlot : line.slotId
}

function getLeaveText(dropped: boolean, name: string, t: TFunction): string {
  return dropped
    ? t('gameDetails.chatTranscript.droppedText', '{{name}} was dropped', { name })
    : t('gameDetails.chatTranscript.leftText', '{{name}} left the game', { name })
}

function formatFrame(frame: number): string {
  return getGameDurationString((frame * 1000) / 24)
}

/** Formats a draft message's time as an offset from the game's start, negative if before it. */
function formatDraftTime(sentAt: number, gameStartTime: number): string {
  const offset = sentAt - gameStartTime
  return (offset < 0 ? '-' : '') + getGameDurationString(Math.abs(offset))
}

function findPlayerByUserId(
  players: ReadonlyMap<number, ReplayChatPlayer>,
  userId: SbUserId,
): ReplayChatPlayer | undefined {
  for (const player of players.values()) {
    if (player.userId === userId) {
      return player
    }
  }
  return undefined
}

function getDraftSenderName(
  userId: SbUserId,
  usersById: ReadonlyMap<SbUserId, SbUser>,
  players: ReadonlyMap<number, ReplayChatPlayer>,
  t: TFunction,
): string {
  return (
    usersById.get(userId)?.name ??
    findPlayerByUserId(players, userId)?.name ??
    t('gameDetails.chatTranscript.unknownUser', 'User {{id}}', { id: userId })
  )
}

function transcriptToText({
  transcript,
  draftMessages,
  gameStartTime,
  usersById,
  t,
}: {
  transcript: ChatTranscript
  draftMessages: ReadonlyArray<ReadonlyDeep<GameDraftMessageJson>>
  gameStartTime: number
  usersById: ReadonlyMap<SbUserId, SbUser>
  t: TFunction
}): string {
  const gameText = transcript.lines
    .map(line => {
      const name = getPlayerName(transcript.players, getLineSlot(line), t)
      const text =
        line.kind === 'chat'
          ? `${getScopeLabel(line.scope, t)} ${name}: ${line.text}`
          : getLeaveText(line.dropped, name, t)
      return `[${formatFrame(line.frame)}] ${text}`
    })
    .join('\n')
  if (!draftMessages.length) {
    return gameText
  }

  const draftText = draftMessages
    .map(message => {
      const name = getDraftSenderName(message.userId, usersById, transcript.players, t)
      return (
        `[${formatDraftTime(message.sentAt, gameStartTime)}] ` +
        `${getScopeLabel('team', t)} ${name}: ${message.text}`
      )
    })
    .join('\n')
  return [
    t('gameDetails.chatTranscript.draftTitle', 'Draft'),
    draftText,
    '',
    t('gameDetails.chatTranscript.gameTitle', 'Game'),
    gameText,
  ].join('\n')
}

/**
 * Lets an admin view a game's chat and when its players left, reconstructed from its players'
 * uploaded replays: the longest replay from each side is read and merged, with each message's
 * recipients inferred from which sides' replays recorded it (see `buildChatTranscript`). The chat
 * from the game's race draft, if it had one, is shown ahead of it.
 */
export function ChatTranscriptSection({
  config,
  replays,
  draftMessages,
  gameStartTime,
}: {
  config: ReadonlyDeep<GameConfig>
  replays: ReadonlyArray<ReadonlyDeep<GameReplayDebugInfo>>
  draftMessages: ReadonlyArray<ReadonlyDeep<GameDraftMessageJson>>
  gameStartTime: number
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const usersById = useAppSelector(s => s.users.byId)
  const [state, setState] = useState<TranscriptState>({ status: 'idle' })
  const [hidden, setHidden] = useState(false)
  const abortControllerRef = useRef<AbortController>(undefined)

  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  const sides = getChatSides(config)
  const selectedReplays = selectChatTranscriptReplays(sides, replays)
  const hasAnyChatSource = selectedReplays.length > 0 || draftMessages.length > 0

  const onToggle = () => {
    if (state.status === 'loaded') {
      setHidden(!hidden)
      return
    }

    setHidden(false)
    setState({ status: 'loading' })
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    dispatch(
      loadGameChatTranscript(sides, selectedReplays, {
        signal: abortController.signal,
        onSuccess: transcript => setState({ status: 'loaded', transcript }),
        onError: err => {
          logger.error(`Error loading chat transcript: ${getErrorStack(err)}`)
          setState({ status: 'error' })
        },
      }),
    )
  }

  const onCopy = (transcript: ChatTranscript) => {
    const text = transcriptToText({ transcript, draftMessages, gameStartTime, usersById, t })
    navigator.clipboard.writeText(text).catch(err => {
      logger.error(`Error writing chat transcript to clipboard: ${getErrorStack(err)}`)
    })
  }

  const showTranscript = state.status === 'loaded' && !hidden

  return (
    <Root>
      <OutlinedButton
        label={
          showTranscript
            ? t('gameDetails.chatTranscript.hide', 'Hide chat transcript')
            : t('gameDetails.chatTranscript.view', 'View chat transcript')
        }
        iconStart='forum'
        onClick={onToggle}
        disabled={state.status === 'loading' || !hasAnyChatSource}
      />
      {!hasAnyChatSource ? (
        <StatusLine>
          {t('gameDetails.chatTranscript.noReplays', 'No replays were uploaded for this game.')}
        </StatusLine>
      ) : null}
      {state.status === 'error' ? (
        <StatusLine>
          {t('gameDetails.chatTranscript.loadError', 'Failed to load the chat transcript.')}
        </StatusLine>
      ) : null}
      {showTranscript ? (
        <TranscriptCard>
          <TranscriptHeader>
            <TranscriptTitle>
              {t('gameDetails.chatTranscript.title', 'Chat transcript')}
            </TranscriptTitle>
            <Tooltip text={t('gameDetails.chatTranscript.copy', 'Copy transcript')} position='left'>
              <IconButton
                icon={<MaterialIcon icon='content_copy' />}
                title={t('gameDetails.chatTranscript.copy', 'Copy transcript')}
                onClick={() => onCopy(state.transcript)}
              />
            </Tooltip>
          </TranscriptHeader>
          {selectedReplays.length > 0 ? (
            <SourcesLine>
              {t('gameDetails.chatTranscript.sources', 'Merged from the replays uploaded by:')}{' '}
              {selectedReplays.map(({ replay }, i) => (
                <span key={replay.id}>
                  {i > 0 ? ', ' : ''}
                  <ConnectedUsername userId={replay.uploadedByUserId} />
                </span>
              ))}
            </SourcesLine>
          ) : null}
          {draftMessages.length > 0 ? (
            <>
              <SegmentTitle>{t('gameDetails.chatTranscript.draftTitle', 'Draft')}</SegmentTitle>
              <Lines>
                {draftMessages.map((message, i) => (
                  <DraftLine
                    key={i}
                    message={message}
                    gameStartTime={gameStartTime}
                    player={findPlayerByUserId(state.transcript.players, message.userId)}
                    senderName={getDraftSenderName(
                      message.userId,
                      usersById,
                      state.transcript.players,
                      t,
                    )}
                  />
                ))}
              </Lines>
              <SegmentTitle>{t('gameDetails.chatTranscript.gameTitle', 'Game')}</SegmentTitle>
            </>
          ) : null}
          {state.transcript.lines.length > 0 ? (
            <Lines>
              {state.transcript.lines.map((line, i) => (
                <TranscriptLine
                  key={i}
                  line={line}
                  player={state.transcript.players.get(getLineSlot(line))}
                  playerName={getPlayerName(state.transcript.players, getLineSlot(line), t)}
                />
              ))}
            </Lines>
          ) : (
            <StatusLine>
              {selectedReplays.length > 0
                ? t(
                    'gameDetails.chatTranscript.empty',
                    'No chat or leaves were recorded in these replays.',
                  )
                : t(
                    'gameDetails.chatTranscript.noReplays',
                    'No replays were uploaded for this game.',
                  )}
            </StatusLine>
          )}
        </TranscriptCard>
      ) : null}
    </Root>
  )
}

function TranscriptLine({
  line,
  player,
  playerName,
}: {
  line: ChatTranscriptLine
  player?: ReplayChatPlayer
  playerName: string
}) {
  const { t } = useTranslation()

  if (line.kind === 'leave') {
    return (
      <Line>
        <Timestamp>{formatFrame(line.frame)}</Timestamp>{' '}
        <LeaveText>
          {line.dropped ? (
            <Trans t={t} i18nKey='gameDetails.chatTranscript.dropped'>
              <PlayerName style={{ color: player?.color }}>
                {{ name: playerName } as TransInterpolation}
              </PlayerName>{' '}
              was dropped
            </Trans>
          ) : (
            <Trans t={t} i18nKey='gameDetails.chatTranscript.left'>
              <PlayerName style={{ color: player?.color }}>
                {{ name: playerName } as TransInterpolation}
              </PlayerName>{' '}
              left the game
            </Trans>
          )}
        </LeaveText>
      </Line>
    )
  }

  const scopeLabel = getScopeLabel(line.scope, t)
  return (
    <Line>
      <Timestamp>{formatFrame(line.frame)}</Timestamp>{' '}
      {line.scope === 'unknown' ? (
        <Tooltip
          text={t(
            'gameDetails.chatTranscript.scopeUnknownTooltip',
            "No other side's replay was recording when this was sent, so its recipients are " +
              'unknown',
          )}
          position='top'
          tabIndex={-1}>
          <Scope>{scopeLabel}</Scope>
        </Tooltip>
      ) : (
        <Scope>{scopeLabel}</Scope>
      )}{' '}
      <PlayerName style={{ color: player?.color }}>{playerName}</PlayerName>: {line.text}
    </Line>
  )
}

function DraftLine({
  message,
  gameStartTime,
  player,
  senderName,
}: {
  message: ReadonlyDeep<GameDraftMessageJson>
  gameStartTime: number
  player?: ReplayChatPlayer
  senderName: string
}) {
  const { t } = useTranslation()

  return (
    <Line>
      <Timestamp>{formatDraftTime(message.sentAt, gameStartTime)}</Timestamp>{' '}
      <Scope>{getScopeLabel('team', t)}</Scope>{' '}
      <PlayerName style={{ color: player?.color }}>{senderName}</PlayerName>: {message.text}
    </Line>
  )
}
