import React, { useMemo } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { matchLinks } from '../../common/text/links'
import { matchMentionsMarkup } from '../../common/text/mentions'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user'
import { ConnectedUsername } from '../profile/connected-username'
import { amberA100, blue100 } from '../styles/colors'
import { body2 } from '../styles/typography'
import { ExternalLink } from './external-link'
import { useMentionFilterClick } from './mention-hooks'
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
  }, [text, selfUserId, filterClick])

  return (
    <TimestampMessageLayout time={time} highlighted={isHighlighted}>
      <Username>
        <ConnectedUsername userId={userId} filterClick={filterClick} />
      </Username>
      <Separator>{': '}</Separator>
      <Text>{parsedText}</Text>
    </TimestampMessageLayout>
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
