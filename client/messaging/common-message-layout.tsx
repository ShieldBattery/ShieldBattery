import { rgba } from 'polished'
import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { replaceMatchesInText } from '../../common/regex/replace-matches'
import { matchLinks } from '../../common/text/links'
import { matchMentionsMarkup } from '../../common/text/mentions'
import { SbUserId } from '../../common/users/user-info'
import { useSelfUser } from '../auth/state-hooks'
import { amberA100, blue400 } from '../styles/colors'
import { body2 } from '../styles/typography'
import { ConnectedUsername } from './connected-username'
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

const UserMention = styled.span`
  background-color: ${rgba(blue400, 0.48)};

  &:hover {
    background-color: ${rgba(blue400, 0.87)};
  }
`

export const TextMessage = React.memo<{ userId: SbUserId; time: number; text: string }>(props => {
  const { userId, time, text } = props
  const selfUserId = useSelfUser().id
  const [isHighlighted, setIsHighlighted] = useState(false)
  const parsedText = useMemo(() => {
    const matchedMentions = matchMentionsMarkup(text)
    const matchedLinks = matchLinks(text)

    return replaceMatchesInText([...matchedMentions, ...matchedLinks], text, match => {
      if (match.groups?.mention !== undefined) {
        const userId = Number(match.groups!.userId) as SbUserId
        if (userId === selfUserId) {
          setIsHighlighted(true)
        }

        return (
          <UserMention key={match.index}>
            <ConnectedUsername userId={userId} isMention={true} />
          </UserMention>
        )
      } else if (match.groups?.link !== undefined) {
        // TODO(tec27): Handle links to our own host specially, redirecting to the correct route
        // in-client instead
        // TODO(2Pac): Show a warning message about opening untrusted links
        return (
          <a key={match.index} href={match[0]} target='_blank' rel='noopener nofollow'>
            {match[0]}
          </a>
        )
      } else {
        return match[0]
      }
    })
  }, [text, selfUserId])

  return (
    <TimestampMessageLayout time={time} highlighted={isHighlighted}>
      <Username>
        <ConnectedUsername userId={userId} />
      </Username>
      <Separator aria-hidden={true}>{': '}</Separator>
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
