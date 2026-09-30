import { isPrettyId } from '../../../common/pretty-id'
import { urlPath } from '../../../common/urls'
import { defaultPageImage, PageMetadataResolver } from '../page-metadata/types'

/**
 * Resolves the Open Graph/Twitter Card metadata for a private channel's invite link (registered for
 * the `/chat/invite/:token` route in `page-metadata.ts`).
 *
 * The preview is the same for every link and never looks the link up: a private channel's name is
 * only for its members, whoever unfurls a link (a chat service's crawler, say) isn't one, and an
 * unfurled preview lives on after the link stops working. Every response is marked `noindex`, since
 * the link is a capability rather than a public page.
 */
export const channelInvitePageMetadata: PageMetadataResolver = async (params, context) => {
  if (!params.token || !isPrettyId(params.token)) {
    return undefined
  }

  return {
    url: context.canonicalHost + urlPath`/chat/invite/${params.token}`,
    type: 'website',
    title: "You've been invited to a private channel on ShieldBattery",
    description: 'Join the conversation in a private chat channel on ShieldBattery.',
    image: defaultPageImage(context),
    noindex: true,
  }
}
