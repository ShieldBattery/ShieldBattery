import { useTranslation } from 'react-i18next'
import { SbChannelId } from '../../common/chat'
import { ExternalLink, isShieldBatteryUrl } from '../navigation/external-link'
import { channelMessageFromUrl, ChannelMessageLinkTarget } from './channel-url'
import { ConnectedChannelName } from './connected-channel-name'

/**
 * Returns the channel and message embedded in a chat message link, or undefined if the link isn't
 * a ShieldBattery channel message link (an external URL, or a ShieldBattery URL for something
 * other than a channel message).
 */
export function channelMessageFromMessageLink(href: string): ChannelMessageLinkTarget | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }

  return isShieldBatteryUrl(url) ? channelMessageFromUrl(url) : undefined
}

/**
 * Renders a chat message link (minted by "Copy message link", see `channel-menu-items.tsx`) as an
 * in-app link labeled with the channel it points at, e.g. "#some-channel › message", rather than
 * the raw URL. The URL is intentionally not shown as text -- it still lives on the rendered
 * anchor's `href`, so "Copy link" in the message context menu (which reads the clicked element's
 * closest anchor's `href`) and ctrl/shift-click to open in a new window both still work on it.
 */
export function ChannelMessageLink({ href, channelId }: { href: string; channelId: SbChannelId }) {
  const { t } = useTranslation()

  return (
    <ExternalLink href={href}>
      <ConnectedChannelName channelId={channelId} interactive={false} />
      {/* Non-breaking spaces keep the label from wrapping between its parts, while an over-long
          channel name can still break mid-word the way any other over-long word in the message does. */}
      {'\u00A0›\u00A0'}
      {t('chat.messageLink.label', 'message')}
    </ExternalLink>
  )
}
