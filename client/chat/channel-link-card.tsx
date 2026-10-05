import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SbChannelId } from '../../common/chat'
import { BackdropCardLoading } from '../messaging/backdrop-card'
import { isShieldBatteryUrl } from '../navigation/external-link'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import {
  getBatchChannelInfo,
  joinChannelWithErrorHandling,
  navigateToChannel,
} from './action-creators'
import { CHANNEL_PREVIEW_CARD_HEIGHT, ChannelPreviewCard } from './channel-preview-card'
import { channelFromUrl } from './channel-url'

/**
 * Returns the channel a chat message link points at, or undefined if the link isn't a ShieldBattery
 * channel link (an external URL, a link to one of a channel's messages, or a ShieldBattery URL for
 * something other than a channel).
 */
export function channelFromMessageLink(href: string): SbChannelId | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }

  return isShieldBatteryUrl(url) ? channelFromUrl(url) : undefined
}

/**
 * A preview of the channel a link in a message points at, from which the viewer can join it (or
 * open it, if they're already in it). Joining moves the viewer into the channel.
 *
 * Renders nothing for a channel that doesn't exist anymore or that server moderators have closed
 * (nobody can join one), or for a private channel the viewer isn't in: its info is for members
 * only, and an invite link is how one gets shared. Info lookups go through the batched channel info
 * request, so a page full of channel links costs one request.
 */
export function ChannelLinkCard({ channelId }: { channelId: SbChannelId }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const basicInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const detailedInfo = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId))
  const isMember = useAppSelector(s => s.chat.joinedChannels.has(channelId))
  const isDeleted = useAppSelector(s => s.chat.deletedChannels.has(channelId))
  const isWithheld = useAppSelector(s => s.chat.privateChannels.has(channelId))
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    dispatch(getBatchChannelInfo(channelId))
  }, [dispatch, channelId])

  // Server moderators are given a private channel's info without being in it, but the card is for
  // channels the viewer could join from it, so they're treated like anyone else outside it.
  if (isDeleted || basicInfo?.closed || (!isMember && (isWithheld || basicInfo?.private))) {
    return null
  }

  if (!basicInfo || !detailedInfo) {
    return <BackdropCardLoading $height={CHANNEL_PREVIEW_CARD_HEIGHT} aria-hidden={true} />
  }

  return (
    <ChannelPreviewCard
      title={
        basicInfo.private
          ? t('chat.inviteCard.title', 'Private channel')
          : t('chat.linkCard.title', 'Channel')
      }
      channelName={basicInfo.name}
      bannerPath={detailedInfo.bannerPath}
      userCount={detailedInfo.userCount}
      description={detailedInfo.description}
      isMember={isMember}
      onViewClick={() => navigateToChannel(channelId, basicInfo.name)}
      onJoinClick={() => {
        if (joining) {
          return
        }

        // The channel is joined by the name it has now, not the one in the link, which may be stale.
        setJoining(true)
        dispatch(
          joinChannelWithErrorHandling(basicInfo.name, {
            onSuccess: () => setJoining(false),
            onError: () => setJoining(false),
          }),
        )
      }}
      testName='channel-link-card'
    />
  )
}
