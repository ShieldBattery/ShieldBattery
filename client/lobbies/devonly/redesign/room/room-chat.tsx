import { useState } from 'react'
import styled from 'styled-components'
import { shortTimestamp } from '../../../../i18n/date-formats'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { IconButton } from '../../../../material/button'
import { TextField } from '../../../../material/text-field'
import { bodyMedium, labelMedium, titleSmall } from '../../../../styles/typography'
import { ConnectedUsername } from '../../../../users/connected-username'
import { MockChatLine, ScenarioData } from '../mock-data'
import { ResultsCard } from './results-card'
import { RoomViewer } from './room-model'

/**
 * The mock chat carries no timestamps, so lines are spread backwards from the moment the page
 * loaded at a fixed cadence — enough for the message list to read like a real log.
 */
const CHAT_BASE_TIME = Date.now()
const CHAT_LINE_SPACING_MS = 47_000

function timeForLine(index: number, lineCount: number): number {
  return CHAT_BASE_TIME - (lineCount - 1 - index) * CHAT_LINE_SPACING_MS
}

const ChatRoot = styled.div`
  flex-grow: 1;
  min-width: 0;
  min-height: 0;

  display: flex;
  flex-direction: column;
`

const MessageList = styled.div`
  flex-grow: 1;
  min-height: 0;
  padding-block: 12px;

  display: flex;
  flex-direction: column;

  overflow-y: auto;
`

/**
 * Keeps a short log pinned to the bottom of the list (where new messages arrive) without the
 * clipping that `justify-content: flex-end` causes once the log overflows.
 */
const Messages = styled.div`
  margin-top: auto;
`

const Timestamp = styled.span`
  ${labelMedium};

  width: 72px;
  padding-right: 8px;

  display: inline-block;

  color: var(--color-grey-blue70);
  line-height: inherit;
  text-align: right;
`

/**
 * Hanging-indent message layout: the timestamp lives in the padding so wrapped text lines up under
 * the message rather than under the clock.
 */
const Line = styled.div`
  ${bodyMedium};

  width: 100%;
  min-height: 20px;
  padding: 3px 16px 3px 72px;

  line-height: 20px;
  text-indent: -72px;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  }
`

const SelfLine = styled(Line)`
  box-shadow: inset 2px 0 0 0 var(--color-blue70);
`

const SystemLine = styled(Line)`
  color: var(--color-blue90);
`

const SystemIcon = styled(MaterialIcon)`
  margin-right: 6px;

  color: var(--color-blue70);
  vertical-align: -3px;
`

const Author = styled.span`
  ${titleSmall};

  line-height: inherit;
`

const AuthorSeparator = styled.span`
  margin-right: 6px;

  color: var(--theme-on-surface-variant);
`

const Composer = styled.div`
  flex-shrink: 0;
  padding: 8px 12px 12px;

  display: flex;
  align-items: flex-end;
  gap: 4px;

  border-top: 1px solid var(--theme-outline-variant);
`

const ComposerField = styled(TextField)`
  flex-grow: 1;
`

function ChatMessage({
  line,
  time,
  isSelf,
}: {
  line: MockChatLine
  time: number
  isSelf: boolean
}) {
  if (line.system) {
    return (
      <SystemLine>
        <Timestamp>{shortTimestamp.format(time)}</Timestamp>
        <SystemIcon icon='bolt' size={16} />
        {line.text}
      </SystemLine>
    )
  }

  const Container = isSelf ? SelfLine : Line
  return (
    <Container>
      <Timestamp>{shortTimestamp.format(time)}</Timestamp>
      <Author>
        {line.userId !== undefined ? (
          <ConnectedUsername userId={line.userId} interactive={false} />
        ) : null}
      </Author>
      <AuthorSeparator>:</AuthorSeparator>
      {line.text}
    </Container>
  )
}

/**
 * The room's hero: lobby chat, full height, with the lifecycle's notable moments landing in it as
 * they happen. System notices read as notices rather than as someone talking, and the results of a
 * finished game arrive as a card instead of a line of text.
 */
export function RoomChat({ data, viewer }: { data: ScenarioData; viewer: RoomViewer }) {
  const [message, setMessage] = useState('')

  const sendMessage = () => {
    if (message.trim().length > 0) {
      console.log('send chat message', message)
      setMessage('')
    }
  }

  return (
    <ChatRoot>
      <MessageList>
        <Messages>
          {data.chat.map((line, i) =>
            line.resultsCard ? (
              <ResultsCard key={line.id} data={data} viewer={viewer} />
            ) : (
              <ChatMessage
                key={line.id}
                line={line}
                time={timeForLine(i, data.chat.length)}
                isSelf={line.userId === viewer.userId}
              />
            ),
          )}
        </Messages>
      </MessageList>
      <Composer>
        <ComposerField
          label='Send a message'
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
        <IconButton
          icon={<MaterialIcon icon='send' />}
          title='Send'
          ariaLabel='Send'
          onClick={sendMessage}
        />
      </Composer>
    </ChatRoot>
  )
}
