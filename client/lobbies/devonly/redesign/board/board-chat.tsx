import styled from 'styled-components'
import { ConnectedAvatar } from '../../../../avatars/avatar'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { IconButton } from '../../../../material/button'
import { ContainerLevel, containerStyles } from '../../../../styles/colors'
import { bodyMedium, labelMedium, labelSmall, titleSmall } from '../../../../styles/typography'
import { ConnectedUsername } from '../../../../users/connected-username'
import { MockChatLine } from '../mock-data'
import { BoardModel, logBoardAction } from './board-model'
import { ResultsCard } from './results-card'

const ChatPanel = styled.div<{ $tall: boolean }>`
  ${containerStyles(ContainerLevel.Low)};

  height: ${props => (props.$tall ? 440 : 320)}px;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;

  border-radius: 12px;
  border: 1px solid var(--theme-outline-variant);
  contain: paint;
`

const ChatHeader = styled.div`
  height: 40px;
  padding-inline: 14px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 8px;

  border-bottom: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface-variant);
`

const ChatTitle = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface);
`

const ChatHint = styled.div`
  ${labelSmall};
  margin-left: auto;
  color: var(--theme-on-surface-variant);
`

const MessageScroll = styled.div`
  flex-grow: 1;
  min-height: 0;
  padding: 8px 14px;

  display: flex;
  flex-direction: column;
  overflow-y: auto;
`

const Messages = styled.div`
  margin-top: auto;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const SystemLine = styled.div`
  ${labelMedium};
  padding-block: 2px;

  display: flex;
  align-items: center;
  gap: 6px;

  color: var(--theme-on-surface-variant);
`

const UserLine = styled.div`
  ${bodyMedium};
  padding-block: 2px;

  display: flex;
  align-items: baseline;
  gap: 8px;

  color: var(--theme-on-surface);
`

const LineAvatar = styled(ConnectedAvatar)`
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  align-self: center;
`

const LineName = styled.div`
  ${titleSmall};
  flex-shrink: 0;
  color: var(--color-blue80);
`

const LineText = styled.div`
  min-width: 0;
  word-break: break-word;
`

const ChatInputRow = styled.div`
  height: 48px;
  padding-inline: 8px 4px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 8px;

  border-top: 1px solid var(--theme-outline-variant);
`

const ChatInput = styled.input`
  ${bodyMedium};
  flex-grow: 1;
  min-width: 0;
  height: 36px;
  padding-inline: 8px;

  background-color: transparent;
  border: none;
  color: var(--theme-on-surface);
  outline: none;

  &::placeholder {
    color: var(--theme-on-surface-variant);
  }
`

function ChatLine({ model, line }: { model: BoardModel; line: MockChatLine }) {
  if (line.resultsCard) {
    return <ResultsCard model={model} />
  }

  if (line.system || line.userId === undefined) {
    return (
      <SystemLine>
        <MaterialIcon icon='chevron_right' size={16} />
        {line.text}
      </SystemLine>
    )
  }

  return (
    <UserLine>
      <LineAvatar userId={line.userId} />
      <LineName>
        <ConnectedUsername userId={line.userId} />
      </LineName>
      <LineText>{line.text}</LineText>
    </UserLine>
  )
}

/**
 * The lobby's conversation. Deliberately secondary to the board above it — the room's talk track,
 * not the room itself — but generous enough to actually hold a conversation, and the surface the
 * game's results land in when a game ends.
 */
export function BoardChat({ model }: { model: BoardModel }) {
  return (
    <ChatPanel $tall={model.lifecycle === 'regroup'}>
      <ChatHeader>
        <MaterialIcon icon='forum' size={20} />
        <ChatTitle>Lobby chat</ChatTitle>
        <ChatHint>Everyone here, seated or not</ChatHint>
      </ChatHeader>
      <MessageScroll>
        <Messages>
          {model.data.chat.map(line => (
            <ChatLine key={line.id} model={model} line={line} />
          ))}
        </Messages>
      </MessageScroll>
      <ChatInputRow>
        <ChatInput
          placeholder='Send a message'
          onKeyDown={event => {
            if (event.key === 'Enter') {
              logBoardAction('sendChatMessage', event.currentTarget.value)
              event.currentTarget.value = ''
            }
          }}
        />
        <IconButton
          icon={<MaterialIcon icon='send' />}
          title='Send'
          onClick={() => logBoardAction('sendChatMessage')}
        />
      </ChatInputRow>
    </ChatPanel>
  )
}
