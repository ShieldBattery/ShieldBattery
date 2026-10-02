import type { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import { GameConfig } from '../../common/games/configuration'
import { GameReplayDebugInfo, getGameDurationString } from '../../common/games/games'
import { ReplayChatPlayer } from '../../common/replays'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { IconButton, OutlinedButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { selectableTextContainer } from '../styles/text-selection'
import { bodyMedium, labelLarge, labelMedium, titleLarge } from '../styles/typography'
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

function transcriptToText(transcript: ChatTranscript, t: TFunction): string {
  return transcript.lines
    .map(line => {
      const name = getPlayerName(transcript.players, getLineSlot(line), t)
      const text =
        line.kind === 'chat'
          ? `${getScopeLabel(line.scope, t)} ${name}: ${line.text}`
          : getLeaveText(line.dropped, name, t)
      return `[${formatFrame(line.frame)}] ${text}`
    })
    .join('\n')
}

/**
 * Lets an admin view a game's chat and when its players left, reconstructed from its players'
 * uploaded replays: the longest replay from each side is read and merged, with each message's
 * recipients inferred from which sides' replays recorded it (see `buildChatTranscript`).
 */
export function ChatTranscriptSection({
  config,
  replays,
}: {
  config: ReadonlyDeep<GameConfig>
  replays: ReadonlyArray<ReadonlyDeep<GameReplayDebugInfo>>
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [state, setState] = useState<TranscriptState>({ status: 'idle' })
  const abortControllerRef = useRef<AbortController>(undefined)

  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  const sides = getChatSides(config)
  const selectedReplays = selectChatTranscriptReplays(sides, replays)

  const onView = () => {
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
    navigator.clipboard.writeText(transcriptToText(transcript, t)).catch(err => {
      logger.error(`Error writing chat transcript to clipboard: ${getErrorStack(err)}`)
    })
  }

  return (
    <Root>
      <OutlinedButton
        label={t('gameDetails.chatTranscript.view', 'View chat transcript')}
        iconStart={<MaterialIcon icon='forum' />}
        onClick={onView}
        disabled={state.status === 'loading' || selectedReplays.length === 0}
      />
      {selectedReplays.length === 0 ? (
        <StatusLine>
          {t('gameDetails.chatTranscript.noReplays', 'No replays were uploaded for this game.')}
        </StatusLine>
      ) : null}
      {state.status === 'error' ? (
        <StatusLine>
          {t('gameDetails.chatTranscript.loadError', 'Failed to load the chat transcript.')}
        </StatusLine>
      ) : null}
      {state.status === 'loaded' ? (
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
          <SourcesLine>
            {t('gameDetails.chatTranscript.sources', 'Merged from the replays uploaded by:')}{' '}
            {selectedReplays.map(({ replay }, i) => (
              <span key={replay.id}>
                {i > 0 ? ', ' : ''}
                <ConnectedUsername userId={replay.uploadedByUserId} />
              </span>
            ))}
          </SourcesLine>
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
              {t(
                'gameDetails.chatTranscript.empty',
                'No chat or leaves were recorded in these replays.',
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
