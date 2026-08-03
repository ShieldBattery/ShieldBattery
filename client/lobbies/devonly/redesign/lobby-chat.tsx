import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../../avatars/avatar'
import { randomColorForString } from '../../../avatars/colors'
import { MaterialIcon } from '../../../icons/material/material-icon'
import { OutlinedButton, TextButton } from '../../../material/button'
import { TextField } from '../../../material/text-field'
import { useAppSelector } from '../../../redux-hooks'
import {
  bodyLarge,
  labelLarge,
  labelMedium,
  titleMedium,
  titleSmall,
} from '../../../styles/typography'
import { LobbyView, logAction } from './lobby-model'
import { MockChatLine } from './mock-data'

const Root = styled.div`
  flex-grow: 1;
  min-height: 0;

  display: flex;
  flex-direction: column;
`

const MessageList = styled.div`
  flex-grow: 1;
  min-height: 0;
  padding: 12px 20px;

  display: flex;
  flex-direction: column;

  overflow-y: auto;
`

/** Keeps a short log pinned to the bottom of the list without clipping once it overflows. */
const Messages = styled.div`
  margin-top: auto;

  display: flex;
  flex-direction: column;
  gap: 10px;
`

const AuthorLine = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
`

const AuthorName = styled.span`
  ${titleSmall};
`

const Timestamp = styled.span`
  ${labelMedium};

  color: rgb(from var(--theme-on-surface) r g b / 0.4);
`

const MessageText = styled.div`
  ${bodyLarge};

  color: var(--theme-on-surface);
`

const SystemLine = styled.div`
  ${labelMedium};

  display: flex;
  align-items: center;
  gap: 6px;

  color: rgb(from var(--theme-on-surface) r g b / 0.5);
`

const SettingsCard = styled.div`
  ${labelLarge};

  max-width: 520px;
  padding: 10px 12px;

  display: flex;
  align-items: flex-start;
  gap: 8px;

  background-color: rgb(from var(--theme-amber) r g b / 0.1);
  border-left: 3px solid var(--theme-amber);
  border-radius: 4px;
  color: var(--theme-amber);
`

const SettingsName = styled.span`
  ${titleSmall};

  color: var(--theme-amber);
`

const JoinCard = styled.div`
  max-width: 420px;
  padding: 10px 12px;

  display: flex;
  align-items: center;
  gap: 10px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const JoinAvatar = styled(ConnectedAvatar)`
  width: 28px;
  height: 28px;
  flex-shrink: 0;
`

const JoinText = styled.div`
  ${labelLarge};
`

const JoinDetail = styled.div`
  ${labelMedium};

  color: var(--theme-on-surface-variant);
`

const VictoryCard = styled.div`
  max-width: 460px;
  padding: 14px 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const VictoryHeading = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
`

const Trophy = styled(MaterialIcon)`
  color: var(--theme-amber);
`

const VictoryTitle = styled.div`
  ${titleMedium};
`

const VictoryDetail = styled.div`
  ${labelMedium};

  color: var(--theme-on-surface-variant);
`

const VictoryActions = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const SummaryButton = styled(TextButton)`
  color: var(--theme-amber);
`

const Composer = styled.div`
  flex-shrink: 0;
  padding: 0 20px 16px;
`

function Author({ userId }: { userId: SbUserId }) {
  const name = useAppSelector(s => s.users.byId.get(userId)?.name)
  return (
    <AuthorName style={{ color: name ? randomColorForString(name) : undefined }}>
      {name ?? '…'}
    </AuthorName>
  )
}

function UserText({ userId }: { userId: SbUserId }) {
  const name = useAppSelector(s => s.users.byId.get(userId)?.name)
  return <>{name ?? '…'}</>
}

function ChatLine({ view, line }: { view: LobbyView; line: MockChatLine }) {
  switch (line.kind) {
    case 'text':
      return (
        <div>
          <AuthorLine>
            <Author userId={line.userId} />
            <Timestamp>{line.time}</Timestamp>
          </AuthorLine>
          <MessageText>{line.text}</MessageText>
        </div>
      )

    case 'system':
      return (
        <SystemLine>
          <MaterialIcon icon={line.icon} size={16} />
          {line.text}
        </SystemLine>
      )

    case 'settingsChange':
      return (
        <SettingsCard>
          <MaterialIcon icon={line.icon} size={18} />
          <div>
            <UserText userId={line.userId} /> changed the{' '}
            <SettingsName>{line.setting}</SettingsName>: {line.change}
            {line.readyReset ? ' · ready reset' : null}
          </div>
        </SettingsCard>
      )

    case 'joinCard':
      return (
        <JoinCard>
          <JoinAvatar userId={line.userId} />
          <div>
            <JoinText>{line.text}</JoinText>
            <JoinDetail>{line.detail}</JoinDetail>
          </div>
        </JoinCard>
      )

    case 'victoryCard': {
      const victory = view.data.victory
      if (!victory) {
        return null
      }
      return (
        <VictoryCard>
          <VictoryHeading>
            <Trophy icon='trophy' size={24} />
            <div>
              <VictoryTitle>Victory — {victory.winner}</VictoryTitle>
              <VictoryDetail>
                {victory.duration} · {victory.roster}
              </VictoryDetail>
            </div>
          </VictoryHeading>
          <VictoryActions>
            <OutlinedButton
              label='WATCH REPLAY'
              iconStart={<MaterialIcon icon='play_arrow' size={20} />}
              onClick={() => logAction('watchReplay')}
            />
            <SummaryButton label='FULL SUMMARY' onClick={() => logAction('fullSummary')} />
          </VictoryActions>
        </VictoryCard>
      )
    }

    default:
      return null
  }
}

/**
 * The lobby's conversation, and the widest surface in the room. Everything that happens to the
 * lobby lands here as part of that conversation: arrivals as cards, settings changes as amber
 * notices, and the result of a finished game as a card people can reply under.
 */
export function LobbyChat({ view, placeholder }: { view: LobbyView; placeholder: string }) {
  const [message, setMessage] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // The newest message is the reason to be looking at the log, so the list stays pinned to the
  // bottom whenever the scenario swaps the conversation out.
  useEffect(() => {
    const elem = listRef.current
    if (elem) {
      elem.scrollTop = elem.scrollHeight
    }
  }, [view.data.chat])

  const sendMessage = () => {
    if (message.trim().length > 0) {
      logAction('sendMessage', message)
      setMessage('')
    }
  }

  return (
    <Root>
      <MessageList ref={listRef}>
        <Messages>
          {view.data.chat.map(line => (
            <ChatLine key={line.id} view={view} line={line} />
          ))}
        </Messages>
      </MessageList>
      <Composer>
        <TextField
          label={placeholder}
          value={message}
          floatingLabel={false}
          allowErrors={false}
          multiline={true}
          rows={1}
          maxRows={4}
          onChange={event => setMessage(event.target.value)}
          onEnterKeyDown={event => {
            event.preventDefault()
            sendMessage()
          }}
        />
      </Composer>
    </Root>
  )
}
