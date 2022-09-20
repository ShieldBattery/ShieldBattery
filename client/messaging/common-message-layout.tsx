import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { matchLinks } from '../../common/text/links'
import { matchMentionsMarkup } from '../../common/text/mentions'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user'
import {
  amberA100,
  blue100,
  colorDividers,
  colorTextFaint,
  colorTextSecondary,
} from '../styles/colors'
import { body2 } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { ExternalLink } from './external-link'
import { useChatMenuItems, useMentionFilterClick } from './mention-hooks'
import {
  InfoImportant,
  SeparatedInfoMessage,
  Separator,
  TimestampMessageLayout,
} from './message-layout'

const newDayFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'long',
  day: '2-digit',
})

const Username = styled.span`
  ${body2};

  margin-right: 8px;

  color: ${amberA100};
  line-height: inherit;
`

const Text = styled.span`
  line-height: inherit;
  word-wrap: break-word;
  overflow-wrap: break-word;
  overflow: hidden;
`

const MentionedUsername = styled(ConnectedUsername)`
  color: ${blue100};
`

function* getAllMatches(text: string) {
  yield* matchMentionsMarkup(text)
  yield* matchLinks(text)
}

export const TextMessage = React.memo<{
  userId: SbUserId
  selfUserId: SbUserId
  time: number
  text: string
}>(props => {
  const { userId, selfUserId, time, text } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatMenuItems()
  const [parsedText, isHighlighted] = useMemo(() => {
    const matches = getAllMatches(text)
    const sortedMatches = Array.from(matches).sort((a, b) => a.index - b.index)
    const elements = []
    let lastIndex = 0
    let isHighlighted = false

    for (const match of sortedMatches) {
      // This probably can't happen at this moment, but to ensure we don't get tripped by it in the
      // future, if this happens we skip the match entirely as it means it overlaps with a previous
      // match.
      if (match.index < lastIndex) {
        continue
      }

      // Insert preceding text, if any
      if (match.index > lastIndex) {
        elements.push(text.substring(lastIndex, match.index))
      }

      if (match.type === 'mentionMarkup') {
        const userId = makeSbUserId(Number(match.groups.userId))
        if (userId === selfUserId) {
          isHighlighted = true
        }

        elements.push(
          match.groups.prefix,
          <MentionedUsername
            key={match.index}
            userId={userId}
            prefix={'@'}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />,
        )
      } else if (match.type === 'link') {
        // TODO(tec27): Handle links to our own host specially, redirecting to the correct route
        // in-client instead
        elements.push(
          <ExternalLink key={match.index} href={match.text}>
            {match.text}
          </ExternalLink>,
        )
      } else {
        assertUnreachable(match)
      }

      lastIndex = match.index + match.text.length
    }

    // Insert remaining text, if any
    if (text.length > lastIndex) {
      elements.push(text.substring(lastIndex))
    }

    return [elements, isHighlighted]
  }, [text, selfUserId, filterClick, addChatMenuItems])

  return (
    <TimestampMessageLayout time={time} highlighted={isHighlighted}>
      <Username>
        <ConnectedUsername
          userId={userId}
          filterClick={filterClick}
          modifyMenuItems={addChatMenuItems}
        />
      </Username>
      <Separator>{': '}</Separator>
      <Text>{parsedText}</Text>
    </TimestampMessageLayout>
  )
})

const BlockedText = styled.span`
  color: ${colorTextSecondary};
  line-height: inherit;
  overflow-wrap: break-word;
  overflow: hidden;
  word-wrap: break-word;
`

const BlockedDivider = styled.span`
  padding: 0 8px;
  color: ${colorTextFaint};
`

const ShowHideLink = styled.a`
  color: ${colorTextFaint};

  &:hover {
    cursor: pointer;
  }
`

const VisibleBlockedMessage = styled.div`
  padding: 4px 0;
  background-color: rgba(0, 0, 0, 0.12);
  border: 1px solid ${colorDividers};
  border-radius: 2px;
`

export const BlockedMessage = React.memo<{
  userId: SbUserId
  selfUserId: SbUserId
  time: number
  text: string
}>(props => {
  const [show, setShow] = useState(false)

  return (
    <>
      <TimestampMessageLayout time={props.time} highlighted={false}>
        <BlockedText>Blocked message</BlockedText>
        <BlockedDivider>&mdash;</BlockedDivider>
        <ShowHideLink onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</ShowHideLink>
      </TimestampMessageLayout>
      {show ? (
        <VisibleBlockedMessage>
          <TextMessage
            userId={props.userId}
            selfUserId={props.selfUserId}
            time={props.time}
            text={props.text}
          />
        </VisibleBlockedMessage>
      ) : undefined}
    </>
  )
})

export const NewDayMessage = React.memo<{ time: number }>(props => {
  const { time } = props
  return (
    <SeparatedInfoMessage>
      <span>
        Day changed to <InfoImportant>{newDayFormat.format(time)}</InfoImportant>
      </span>
    </SeparatedInfoMessage>
  )
})
