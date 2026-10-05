import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import {
  BackdropCard,
  BackdropCardAction,
  BackdropCardHeader,
  BackdropCardMeta,
  BackdropCardMetaText,
  BackdropCardTitle,
  backdropTextShadow,
  getBackdropCardHeight,
  TooltipText,
} from '../messaging/backdrop-card'
import { bodySmall, singleLine, titleLarge } from '../styles/typography'
import { ChannelBadge } from './channel-badge'

/** The line height of the typography token the description uses. */
const DETAIL_ROW_HEIGHT = 20

/**
 * The size of the channel's badge, which sets the card body's height. The name and description sit
 * beside it as one block, centered against it.
 */
const BADGE_SIZE = 60

/**
 * The height a channel preview card renders at, which a card's loading placeholder should reserve
 * so the message it's attached to doesn't grow once the card loads.
 */
export const CHANNEL_PREVIEW_CARD_HEIGHT = getBackdropCardHeight(BADGE_SIZE)

const LargeChannelName = styled(TooltipText)`
  ${titleLarge};
  min-width: 0;
  color: var(--theme-on-surface);
`

const Description = styled(TooltipText)`
  ${bodySmall};
  ${singleLine};
  min-width: 0;
  height: ${DETAIL_ROW_HEIGHT}px;
  color: var(--theme-on-surface-variant);
`

const Body = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 16px;
`

const Badge = styled(ChannelBadge)`
  flex-shrink: 0;
  width: ${BADGE_SIZE}px;
  height: ${BADGE_SIZE}px;
  border-radius: 14px;
`

const BodyText = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
`

const PreviewCard = styled(BackdropCard)`
  & ${LargeChannelName}, & ${Description} {
    ${backdropTextShadow};
  }
`

/**
 * A preview of a chat channel shown for a link to it in a message: its banner, badge, name, member
 * count and description, with an action that joins it, or opens it if the viewer is already a
 * member.
 */
export function ChannelPreviewCard({
  title,
  channelName,
  bannerPath,
  badgePath,
  userCount,
  description,
  isMember,
  onViewClick,
  onJoinClick,
  testName,
}: {
  /** What kind of channel the card previews, shown in its header. */
  title: string
  channelName: string
  bannerPath: string | undefined
  badgePath: string | undefined
  userCount: number
  description: string | undefined
  /** Whether the viewer is already in the channel, which swaps joining it for opening it. */
  isMember: boolean
  onViewClick: () => void
  onJoinClick: () => void
  /** Prefix of the test ids given to the card's clickable parts. */
  testName: string
}) {
  const { t } = useTranslation()

  return (
    <PreviewCard
      imageUrl={bannerPath}
      height={CHANNEL_PREVIEW_CARD_HEIGHT}
      onClick={isMember ? onViewClick : undefined}
      actionLabel={t('chat.inviteCard.view', 'View channel')}
      testName={`${testName}-view-button`}>
      <BackdropCardHeader>
        <BackdropCardTitle text={title} />
        <BackdropCardMeta>
          <BackdropCardMetaText
            text={t('chat.inviteCard.memberCount', {
              defaultValue: '{{count}} members',
              defaultValue_one: '{{count}} member',
              count: userCount,
            })}
          />
        </BackdropCardMeta>
        {isMember ? (
          <BackdropCardAction onClick={onViewClick} testName={`${testName}-open-button`}>
            <MaterialIcon icon='arrow_forward' size={18} />
            {t('chat.inviteCard.open', 'View')}
          </BackdropCardAction>
        ) : (
          <BackdropCardAction onClick={onJoinClick} testName={`${testName}-join-button`}>
            <MaterialIcon icon='login' size={18} />
            {t('chat.inviteCard.join', 'Join')}
          </BackdropCardAction>
        )}
      </BackdropCardHeader>
      <Body>
        <Badge src={badgePath} channelName={channelName} />
        <BodyText>
          <LargeChannelName text={`#${channelName}`} />
          <Description
            text={
              description ||
              t('chat.channelInfoCard.noDescription', 'This channel has no description.')
            }
          />
        </BodyText>
      </Body>
    </PreviewCard>
  )
}
