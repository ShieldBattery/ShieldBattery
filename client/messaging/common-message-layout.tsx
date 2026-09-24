import React, { useContext, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { makeSbChannelId } from '../../common/chat'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { RolledOutcome } from '../../common/rolled-outcomes'
import { matchChannelMentionsMarkup } from '../../common/text/channel-mentions'
import { matchLinks } from '../../common/text/links'
import { countEmojisIn, matchUnicodeEmojis, splitEmojiRun } from '../../common/text/unicode-emojis'
import { matchUserMentionsMarkup } from '../../common/text/user-mentions'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import { ConnectedChannelName } from '../chat/connected-channel-name'
import { useContextMenu } from '../dom/use-context-menu'
import { gameFromMessageLink, GameLinkCard, GameLinkTarget } from '../games/game-link-card'
import { TransInterpolation } from '../i18n/i18next'
import {
  LOBBY_INVITE_CARD_MAX_AGE_MS,
  lobbyIdFromMessageLink,
  LobbyInviteCard,
} from '../lobbies/lobby-invite-card'
import { ExternalLink } from '../navigation/external-link'
import { labelSmall, titleSmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { UserMenuComponent } from '../users/user-context-menu'
import { ChatContext } from './chat-context'
import { useMentionFilterClick } from './mention-hooks'
import { MessageContextMenu } from './message-context-menu'
import { MessageEmoji } from './message-emoji'
import {
  InfoImportant,
  SeparatedInfoMessage,
  Separator,
  TimestampMessageLayout,
} from './message-layout'
import { MessageLinkChip, messageLinkFromHref } from './message-link-chip'
import { RolledOutcomeLine } from './rolled-outcome-line'

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
  white-space: pre-wrap;
`

const MentionedUsername = styled(ConnectedUsername)`
  color: var(--color-blue95);
`

const MentionedChannelName = styled(ConnectedChannelName)`
  color: var(--color-blue95);
`

/** The `*` that opens an action line, plus the space that separates it from the name. */
const EmoteGlyph = styled.span`
  line-height: inherit;

  color: var(--theme-on-surface-variant);
  font-style: italic;
`

/**
 * The name in an action line, which reads `* Name action`. A real space separates it from the text,
 * so it carries no margin of its own.
 */
const EmoteUsername = styled(Username)`
  margin-right: 0;

  color: var(--theme-on-surface-variant);
  font-style: italic;
`

const EmoteText = styled(Text)`
  color: var(--theme-on-surface-variant);
  font-style: italic;
`

const MAX_JUMBO_EMOJI_COUNT = 10

/**
 * A message qualifies for jumbo emoji rendering when every match in it is a unicode emoji run, the
 * text outside those runs is whitespace-only, and the total emoji count doesn't exceed the cap (a
 * long run of emoji reads more like a wall of text than a sticker, so it stays inline-sized).
 */
function isJumboEmojiMessage(
  text: string,
  sortedMatches: ReadonlyArray<{ type: string; text: string; index: number }>,
): boolean {
  if (sortedMatches.length === 0 || !sortedMatches.every(match => match.type === 'unicodeEmoji')) {
    return false
  }

  let remainder = ''
  let cursor = 0
  for (const match of sortedMatches) {
    remainder += text.substring(cursor, match.index)
    cursor = match.index + match.text.length
  }
  remainder += text.substring(cursor)

  if (remainder.trim().length > 0) {
    return false
  }

  const emojiCount = countEmojisIn(text)
  return emojiCount > 0 && emojiCount <= MAX_JUMBO_EMOJI_COUNT
}

function* getAllMatches(text: string) {
  yield* matchUserMentionsMarkup(text)
  yield* matchChannelMentionsMarkup(text)
  yield* matchLinks(text)
  yield* matchUnicodeEmojis(text)
}

export interface ParseMessageTextOptions {
  /**
   * The current user, so a mention of them can be reported back to the caller. Left out where a
   * self-mention carries no meaning for the line being built.
   */
  selfUserId?: SbUserId
  /** Passed on to the mentioned usernames, see `ConnectedUsername`. */
  filterClick?: (userId: SbUserId, e: React.MouseEvent | React.KeyboardEvent) => boolean
  UserMenu?: UserMenuComponent
  /** Whether mentioned users and channels can be clicked, focused, etc. */
  interactive: boolean
}

export interface ParsedMessageText {
  /** What the message's text renders as: its plain runs plus everything matched within it. */
  nodes: React.ReactNode[]
  /** Whether the text mentions `selfUserId`. */
  mentionsSelf: boolean
  /** The lobby the first lobby link in the text points at, if it holds one. */
  inviteLobbyId: SbLobbyId | undefined
  /** The game the first game results link in the text points at, if it holds one. */
  linkedGame: GameLinkTarget | undefined
}

/**
 * Turns a message's text into what it renders as: user and channel mentions, links (message links
 * among them), and unicode emoji, with the plain text between them kept as-is. Emoji are sized up
 * when the whole message is nothing but a short run of them.
 */
export function parseMessageText(
  text: string,
  { selfUserId, filterClick, UserMenu, interactive }: ParseMessageTextOptions,
): ParsedMessageText {
  const nodes: React.ReactNode[] = []
  let mentionsSelf = false
  let inviteLobbyId: SbLobbyId | undefined
  let linkedGame: GameLinkTarget | undefined
  const matches = getAllMatches(text)
  const sortedMatches = Array.from(matches).sort((a, b) => a.index - b.index)
  const jumboEmoji = isJumboEmojiMessage(text, sortedMatches)
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
      nodes.push(text.substring(lastIndex, match.index))
    }

    if (match.type === 'userMentionMarkup') {
      const userId = makeSbUserId(Number(match.groups.userId))
      if (userId === selfUserId) {
        mentionsSelf = true
      }

      nodes.push(
        match.groups.prefix,
        <MentionedUsername
          key={match.index}
          userId={userId}
          prefix={'@'}
          filterClick={filterClick}
          UserMenu={UserMenu}
          interactive={interactive}
        />,
      )
    } else if (match.type === 'channelMentionMarkup') {
      const channelId = makeSbChannelId(Number(match.groups.channelId))

      nodes.push(
        match.groups.prefix,
        <MentionedChannelName key={match.index} channelId={channelId} interactive={interactive} />,
      )
    } else if (match.type === 'link') {
      if (inviteLobbyId === undefined) {
        // Only the first lobby link in a message gets an invite card.
        inviteLobbyId = lobbyIdFromMessageLink(match.text)
      }
      if (linkedGame === undefined) {
        // Likewise, only the first game link in a message gets a game card.
        linkedGame = gameFromMessageLink(match.text)
      }

      const messageLink = messageLinkFromHref(match.text)
      if (messageLink) {
        nodes.push(<MessageLinkChip key={match.index} href={match.text} target={messageLink} />)
      } else {
        nodes.push(
          <ExternalLink key={match.index} href={match.text}>
            {match.text}
          </ExternalLink>,
        )
      }
    } else if (match.type === 'unicodeEmoji') {
      let emojiIndex = match.index
      for (const emoji of splitEmojiRun(match.text)) {
        nodes.push(<MessageEmoji key={emojiIndex} emoji={emoji} jumbo={jumboEmoji} />)
        emojiIndex += emoji.length
      }
    } else {
      match satisfies never
    }

    lastIndex = match.index + match.text.length
  }

  // Insert remaining text, if any
  if (text.length > lastIndex) {
    nodes.push(text.substring(lastIndex))
  }

  return { nodes, mentionsSelf, inviteLobbyId, linkedGame }
}

export interface TextMessageProps {
  msgId: string
  userId: SbUserId
  selfUserId: SbUserId
  time: number
  text: string
  /**
   * Whether the message is an action line (sent with `/me`), which reads `* Name action` rather
   * than `Name: text`.
   */
  emote?: boolean
  /**
   * Set for an action line announcing something the server settled for the user (a roll, a coin
   * flip, an 8-ball answer, a unit quote). Implies `emote`-style rendering; the line's wording is
   * composed from this instead of parsed out of `text`.
   */
  outcome?: RolledOutcome
  testId?: string
}

export function TextMessage({
  msgId,
  userId,
  selfUserId,
  time,
  text,
  emote,
  outcome,
  testId,
}: TextMessageProps) {
  const filterClick = useMentionFilterClick()
  const { UserMenu, MessageMenu, disallowMentionInteraction } = useContext(ChatContext)
  // The invite-card age gate needs the current time, which a pure render can't read directly;
  // capture it once on mount. A message mounts when it first becomes visible (on arrival, or when
  // scrollback loads), which is the moment the age check is about.
  const [mountTime] = useState(() => Date.now())

  const { onContextMenu, contextMenuPopoverProps, selectedText, linkHref } = useContextMenu()
  const textRef = useRef<HTMLSpanElement>(null)

  // An outcome line's wording is composed from the outcome, not parsed out of `text` (which holds
  // only the words the user themselves typed), so there is no mention or lobby link to find in it.
  const parsed = outcome
    ? undefined
    : parseMessageText(text, {
        selfUserId,
        filterClick,
        UserMenu,
        interactive: !disallowMentionInteraction,
      })
  const isHighlighted = parsed?.mentionsSelf ?? false
  const inviteLobbyId = parsed?.inviteLobbyId
  const linkedGame = parsed?.linkedGame

  // An outcome is always announced as an action line, whatever flag the message carries.
  const isActionLine = emote === true || outcome !== undefined
  const UsernameComponent = isActionLine ? EmoteUsername : Username
  const TextComponent = isActionLine ? EmoteText : Text

  return (
    <>
      <TimestampMessageLayout
        time={time}
        msgId={msgId}
        active={contextMenuPopoverProps.open}
        highlighted={isHighlighted}
        onContextMenu={onContextMenu}
        testId={testId}>
        {isActionLine ? <EmoteGlyph>{'* '}</EmoteGlyph> : undefined}
        <UsernameComponent
          userId={userId}
          filterClick={filterClick}
          UserMenu={UserMenu}
          interactive={!disallowMentionInteraction}
        />
        {isActionLine ? ' ' : <Separator>{': '}</Separator>}
        <TextComponent ref={textRef}>
          {outcome ? <RolledOutcomeLine outcome={outcome} text={text} /> : parsed?.nodes}
        </TextComponent>
        {inviteLobbyId !== undefined &&
        !disallowMentionInteraction &&
        mountTime - time < LOBBY_INVITE_CARD_MAX_AGE_MS ? (
          <LobbyInviteCard lobbyId={inviteLobbyId} />
        ) : undefined}
        {linkedGame !== undefined && !disallowMentionInteraction ? (
          <GameLinkCard target={linkedGame} />
        ) : undefined}
      </TimestampMessageLayout>

      <MessageContextMenu
        messageId={msgId}
        selectedText={selectedText}
        linkHref={linkHref}
        getMessageText={() => textRef.current?.textContent ?? ''}
        MessageMenu={MessageMenu}
        popoverProps={contextMenuPopoverProps}
      />
    </>
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
  emote?: boolean
  outcome?: RolledOutcome
}>(props => {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)

  return (
    <>
      <TimestampMessageLayout time={props.time} msgId={props.msgId} highlighted={false}>
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
            emote={props.emote}
            outcome={props.outcome}
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

/**
 * Selector for the unread divider, used by the code that scrolls the message list to it and by the
 * banner that offers to.
 */
export const UNREAD_LINE_SELECTOR = '[data-unread-line]'

const UnreadLineRoot = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  padding: 0 8px;

  /**
    The divider is chrome rather than content, so it must stay out of any text the user copies out
    of the message list. The doubled selectors outrank the list container's rule that makes all of
    its descendants selectable.
  */
  &&,
  && * {
    user-select: none;
  }
`

const UnreadLineRule = styled.hr`
  flex-grow: 1;
  margin: 0;

  border: none;
  border-top: 1px solid var(--theme-amber);
`

const UnreadLineLabel = styled.div`
  ${labelSmall};

  flex-shrink: 0;
  padding: 0 6px;

  background-color: var(--theme-amber-container);
  border-radius: 4px;
  color: var(--theme-on-amber-container);
  text-transform: uppercase;
`

/**
 * A divider marking where the messages the user hasn't seen yet begin.
 */
export const UnreadLineMessage = React.memo(() => {
  const { t } = useTranslation()
  return (
    <UnreadLineRoot data-unread-line=''>
      <UnreadLineRule />
      <UnreadLineLabel>{t('messaging.unreadLineLabel', 'New')}</UnreadLineLabel>
    </UnreadLineRoot>
  )
})
