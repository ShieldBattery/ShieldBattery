import React, { useContext, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { makeSbChannelId } from '../../common/chat'
import { matchChannelMentionsMarkup } from '../../common/text/channel-mentions'
import { matchLinks } from '../../common/text/links'
import { matchUserMentionsMarkup } from '../../common/text/user-mentions'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import { ConnectedChannelName } from '../chat/connected-channel-name'
import { useContextMenu } from '../dom/use-context-menu'
import { TransInterpolation } from '../i18n/i18next'
import { MenuList } from '../material/menu/menu'
import { Popover } from '../material/popover'
import { ExternalLink } from '../navigation/external-link'
import { titleSmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { ChatContext, MessageMenuContext } from './chat-context'
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

const Username = styled(ConnectedUsername)`
  ${titleSmall};

  margin-right: 8px;
  padding-block: 4px;

  color: var(--color-amber90);
  line-height: inherit;
`

const Text = styled.span`
  line-height: inherit;
  word-wrap: break-word;
  overflow-wrap: break-word;
  overflow: hidden;
`

const MentionedUsername = styled(ConnectedUsername)`
  color: var(--color-blue95);
`

const MentionedChannelName = styled(ConnectedChannelName)`
  color: var(--color-blue95);
`

function* getAllMatches(text: string) {
  yield* matchUserMentionsMarkup(text)
  yield* matchChannelMentionsMarkup(text)
  yield* matchLinks(text)
}

export interface TextMessageProps {
  msgId: string
  userId: SbUserId
  selfUserId: SbUserId
  time: number
  text: string
  testId?: string
}

export function TextMessage({ msgId, userId, selfUserId, time, text, testId }: TextMessageProps) {
  const filterClick = useMentionFilterClick()
  const { UserMenu, MessageMenu, disallowMentionInteraction } = useContext(ChatContext)

  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()

  const parsedText: React.ReactNode[] = []
  let isHighlighted = false
  const matches = getAllMatches(text)
  const sortedMatches = Array.from(matches).sort((a, b) => a.index - b.index)
  let lastIndex = 0

  for (const match of sortedMatches) {
    // This probably can't happen at this moment, but to ensure we don't get tripped by it in the
    // future, if this happens we skip the match entirely as it means it overlaps with a previous
    // match.
    if (match.index < lastIndex) {
      continue
    }

    // Insert preceding text, if any
    if (match.index > lastIndex) {
      parsedText.push(text.substring(lastIndex, match.index))
    }

    if (match.type === 'userMentionMarkup') {
      const userId = makeSbUserId(Number(match.groups.userId))
      if (userId === selfUserId) {
        isHighlighted = true
      }

      parsedText.push(
        match.groups.prefix,
        <MentionedUsername
          key={match.index}
          userId={userId}
          prefix={'@'}
          filterClick={filterClick}
          UserMenu={UserMenu}
          interactive={!disallowMentionInteraction}
        />,
      )
    } else if (match.type === 'channelMentionMarkup') {
      const channelId = makeSbChannelId(Number(match.groups.channelId))

      parsedText.push(
        match.groups.prefix,
        <MentionedChannelName
          key={match.index}
          channelId={channelId}
          interactive={!disallowMentionInteraction}
        />,
      )
    } else if (match.type === 'link') {
      parsedText.push(
        <ExternalLink key={match.index} href={match.text}>
          {match.text}
        </ExternalLink>,
      )
    } else {
      match satisfies never
    }

    lastIndex = match.index + match.text.length
  }

  // Insert remaining text, if any
  if (text.length > lastIndex) {
    parsedText.push(text.substring(lastIndex))
  }

  // TODO(tec27): Get the base menu items from a context value if/when we need it
  const baseMenuItems: React.ReactNode[] = []
  return (
    <>
      <TimestampMessageLayout
        time={time}
        active={contextMenuPopoverProps.open}
        highlighted={isHighlighted}
        onContextMenu={onContextMenu}
        testId={testId}>
        <Username
          userId={userId}
          filterClick={filterClick}
          UserMenu={UserMenu}
          interactive={!disallowMentionInteraction}
        />
        <Separator>{': '}</Separator>
        <Text>{parsedText}</Text>
      </TimestampMessageLayout>

      <Popover {...contextMenuPopoverProps}>
        <MessageMenu
          messageId={msgId}
          items={baseMenuItems}
          onMenuClose={contextMenuPopoverProps.onDismiss}
          MenuComponent={MessageMenuList}
        />
      </Popover>
    </>
  )
}

function MessageMenuList({
  items,
  messageId,
  onMenuClose,
}: {
  items: ReadonlyArray<React.ReactNode>
  messageId: string
  onMenuClose: (event?: MouseEvent) => void
}) {
  return (
    <MessageMenuContext.Provider value={{ messageId, onMenuClose }}>
      {items.length ? <MenuList dense={true}>{items}</MenuList> : null}
    </MessageMenuContext.Provider>
  )
}

const BlockedText = styled.span`
  color: var(--color-grey-blue80);
  line-height: inherit;
  overflow-wrap: break-word;
  overflow: hidden;
  word-wrap: break-word;
`

const BlockedDivider = styled.span`
  padding: 0 8px;
  color: var(--color-grey-blue80);
`

const ShowHideLink = styled.a`
  color: var(--color-grey-blue80);

  &:hover {
    cursor: pointer;
  }
`

const VisibleBlockedMessage = styled.div`
  padding: 4px 0;
  background-color: var(--theme-container-lowest);
  border: 1px solid var(--theme-outline);
  border-radius: 4px;
`

export const BlockedMessage = React.memo<{
  msgId: string
  userId: SbUserId
  selfUserId: SbUserId
  time: number
  text: string
}>(props => {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)

  return (
    <>
      <TimestampMessageLayout time={props.time} highlighted={false}>
        <BlockedText>{t('messaging.blockedMessage', 'Blocked message')}</BlockedText>
        <BlockedDivider>&mdash;</BlockedDivider>
        <ShowHideLink onClick={() => setShow(!show)}>
          {show ? t('common.actions.hide', 'Hide') : t('common.actions.show', 'Show')}
        </ShowHideLink>
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
  const { t } = useTranslation()
  return (
    <SeparatedInfoMessage>
      <span>
        <Trans t={t} i18nKey='messaging.newDayMessage'>
          Day changed to{' '}
          <InfoImportant>{{ day: newDayFormat.format(time) } as TransInterpolation}</InfoImportant>
        </Trans>
      </span>
    </SeparatedInfoMessage>
  )
})
