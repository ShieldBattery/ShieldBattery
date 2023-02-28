import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { matchLinks } from '../../common/text/links'
import { matchMentionsMarkup } from '../../common/text/mentions'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user'
import { useContextMenu } from '../dom/use-context-menu'
import { MenuList } from '../material/menu/menu'
import { Popover } from '../material/popover'
import { ExternalLink } from '../navigation/external-link'
import { amberA100, blue100, colorDividers, colorTextFaint } from '../styles/colors'
import { body2 } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import {
  useChatMessageMenuItems,
  useChatUserMenuItems,
  useMentionFilterClick,
} from './mention-hooks'
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
  msgId: string
  userId: SbUserId
  selfUserId: SbUserId
  time: number
  text: string
}>(props => {
  const { msgId, userId, selfUserId, time, text } = props
  const filterClick = useMentionFilterClick()
  const addUserMenuItems = useChatUserMenuItems()
  const addMessageMenuItems = useChatMessageMenuItems()

  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()

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
            modifyMenuItems={addUserMenuItems}
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
  }, [text, selfUserId, filterClick, addUserMenuItems])

  // TODO(2Pac): We're currently sending an empty array as default items that will be present in
  // context menu of all text messages here. However, I'm fairly sure that we'll never have common
  // items that are service-independent. Even stuff like adding emoji reactions depends on whether
  // they're being used in a lobby, versus a chat channel (the former is client-only, and the latter
  // probably needs to be saved on the server somewhere).
  // So this API could probably be simplified a bit if it assumes that, instead of making it as
  // customizable as the one we have for the user context menu.
  const messageContextMenuItems = addMessageMenuItems(msgId, [], contextMenuPopoverProps.onDismiss)
  return (
    <>
      <TimestampMessageLayout
        time={time}
        active={contextMenuPopoverProps.open}
        highlighted={isHighlighted}
        onContextMenu={onContextMenu}>
        <Username>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addUserMenuItems}
          />
        </Username>
        <Separator>{': '}</Separator>
        <Text>{parsedText}</Text>
      </TimestampMessageLayout>

      {messageContextMenuItems.length > 0 ? (
        <Popover {...contextMenuPopoverProps}>
          <MenuList dense={true}>{messageContextMenuItems}</MenuList>
        </Popover>
      ) : null}
    </>
  )
})

const BlockedText = styled.span`
  color: ${colorTextFaint};
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
  msgId: string
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
            msgId={props.msgId}
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
