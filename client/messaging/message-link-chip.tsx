import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbChannelId } from '../../common/chat'
import { channelMessageFromUrl } from '../chat/channel-url'
import { ConnectedChannelName } from '../chat/connected-channel-name'
import { MaterialIcon } from '../icons/material/material-icon'
import { ExternalLink, isShieldBatteryUrl } from '../navigation/external-link'
import { whisperMessageFromUrl } from '../whispers/whisper-url'

/** What a message link chip points at: a message in a chat channel, or in a whisper conversation. */
export type MessageLinkTarget =
  | { kind: 'channel'; channelId: SbChannelId; messageId: string }
  | { kind: 'whisper'; messageId: string }

/**
 * Returns the message a chat message link points at, or undefined if `href` isn't one: an external
 * URL, or a ShieldBattery URL for something other than a channel or whisper message link.
 */
export function messageLinkFromHref(href: string): MessageLinkTarget | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }

  if (!isShieldBatteryUrl(url)) {
    return undefined
  }

  const channelMessage = channelMessageFromUrl(url)
  if (channelMessage) {
    return {
      kind: 'channel',
      channelId: channelMessage.channelId,
      messageId: channelMessage.messageId,
    }
  }

  const whisperMessage = whisperMessageFromUrl(url)
  if (whisperMessage) {
    return { kind: 'whisper', messageId: whisperMessage.messageId }
  }

  return undefined
}

// Message rows render inside a fixed 20px line box (see `TimestampMessageLayout` in
// `client/messaging/message-layout.tsx`), so the chip is exactly that tall and top-aligned to sit
// inside the line without growing it. `inline-flex` makes it an atomic inline that wraps as one
// unit rather than splitting across lines; `max-width: 100%` combined with the ellipsized channel
// name below keeps an over-long name from overflowing the message list horizontally instead of
// wrapping. The link color itself comes from the global `a:link`/`a:hover` rules (see
// `client/styles/global.ts`), so the chip still reads as a link -- only their underline needs
// overriding, since this chip conveys its link-ness through its background instead.
//
// The message container's hanging indent (72px of padding pulled back with a negative
// `text-indent`) is meant for the message text only; `text-indent` inherits, and on the chip's
// flex items it would subtract from each item's intrinsic width and collapse them to nothing, so
// the chip resets it.
const ChipLink = styled(ExternalLink)`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: 20px;
  padding: 0 6px 0 4px;
  vertical-align: top;
  text-indent: 0;

  border-radius: 4px;
  background-color: var(--theme-container-high);
  text-decoration: none;

  &:hover {
    background-color: var(--theme-container-highest);
    text-decoration: none;
  }
`

const ChipIcon = styled(MaterialIcon)`
  flex-shrink: 0;
`

// The only shrinkable chip child: an over-long channel name ellipsizes instead of pushing the chip
// wider than the available line.
const ChannelName = styled(ConnectedChannelName)`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Separator = styled.span`
  flex-shrink: 0;
`

const Label = styled.span`
  flex-shrink: 0;
`

/**
 * Renders a chat message link (minted by "Copy message link" in a channel or whisper, see
 * `chat/channel-menu-items.tsx` and `whispers/whisper-menu-items.tsx`) as an in-app chip -- an
 * icon, what it points at, and "message" -- rather than the raw URL. The URL is intentionally not
 * shown as text -- it still lives on the rendered anchor's `href`, so "Copy link" in the message
 * context menu (which reads the clicked element's closest anchor's `href`) and ctrl/shift-click to
 * open in a new window both still work on it.
 *
 * A whisper target renders under a generic "Whisper" label rather than either participant's name:
 * this chip is shown to everyone reading the channel the link was pasted into, most of whom aren't
 * a party to the whisper it points at, and naming a participant would tell them who's whispering
 * with whom even though they can't open the link themselves.
 */
export function MessageLinkChip({ href, target }: { href: string; target: MessageLinkTarget }) {
  const { t } = useTranslation()

  return (
    <ChipLink href={href}>
      <ChipIcon icon='chat' size={16} />
      {target.kind === 'channel' ? (
        <ChannelName channelId={target.channelId} interactive={false} />
      ) : (
        <Label>{t('chat.messageLink.whisper', 'Whisper')}</Label>
      )}
      <Separator>›</Separator>
      <Label>{t('chat.messageLink.label', 'message')}</Label>
    </ChipLink>
  )
}
