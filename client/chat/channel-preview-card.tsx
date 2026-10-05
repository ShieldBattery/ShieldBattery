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

/** The line heights of the typography tokens the card's body stacks, which set its height. */
const TITLE_LARGE_LINE_HEIGHT = 32
const DETAIL_ROW_HEIGHT = 20

const BODY_ROW_GAP = 8
const BODY_HEIGHT = TITLE_LARGE_LINE_HEIGHT + BODY_ROW_GAP + DETAIL_ROW_HEIGHT

/**
 * The height a channel preview card renders at, which a card's loading placeholder should reserve
 * so the message it's attached to doesn't grow once the card loads.
 */
export const CHANNEL_PREVIEW_CARD_HEIGHT = getBackdropCardHeight(BODY_HEIGHT)

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
  flex-direction: column;
  gap: ${BODY_ROW_GAP}px;
`

const PreviewCard = styled(BackdropCard)`
  & ${LargeChannelName}, & ${Description} {
    ${backdropTextShadow};
  }
`

/**
 * A preview of a chat channel shown for a link to it in a message: its banner, name, member count
 * and description, with an action that joins it, or opens it if the viewer is already a member.
 */
export function ChannelPreviewCard({
  title,
  channelName,
  bannerPath,
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
        <LargeChannelName text={`#${channelName}`} />
        {description ? <Description text={description} /> : null}
      </Body>
    </PreviewCard>
  )
}
