import { TFunction } from 'i18next'
import { ChannelInviteLinkJson } from '../../common/chat'
import { RelativeTimeFormatter } from '../i18n/relative-time'

const MINUTE_SECONDS = 60
const HOUR_SECONDS = 60 * MINUTE_SECONDS
const DAY_SECONDS = 24 * HOUR_SECONDS

const timeLeftFormat = new RelativeTimeFormatter(navigator.language, { numeric: 'always' })
const createdAgoFormat = new RelativeTimeFormatter(navigator.language, { numeric: 'auto' })

/** Returns the label for one of the offered invite link lifetimes, `null` being never expiring. */
export function getInviteLinkExpiryOptionLabel(expiresInSeconds: number | null, t: TFunction) {
  if (expiresInSeconds === null) {
    return t('chat.inviteLinks.expiryNever', 'Never')
  } else if (expiresInSeconds % DAY_SECONDS === 0) {
    return t('chat.inviteLinks.expiryDays', {
      defaultValue: '{{count}} days',
      defaultValue_one: '{{count}} day',
      count: expiresInSeconds / DAY_SECONDS,
    })
  } else if (expiresInSeconds % HOUR_SECONDS === 0) {
    return t('chat.inviteLinks.expiryHours', {
      defaultValue: '{{count}} hours',
      defaultValue_one: '{{count}} hour',
      count: expiresInSeconds / HOUR_SECONDS,
    })
  } else {
    return t('chat.inviteLinks.expiryMinutes', {
      defaultValue: '{{count}} minutes',
      defaultValue_one: '{{count}} minute',
      count: Math.round(expiresInSeconds / MINUTE_SECONDS),
    })
  }
}

/** Returns the label for one of the offered invite link use limits, `null` being no limit. */
export function getInviteLinkMaxUsesOptionLabel(maxUses: number | null, t: TFunction) {
  return maxUses === null
    ? t('chat.inviteLinks.maxUsesUnlimited', 'No limit')
    : t('chat.inviteLinks.maxUsesCount', {
        defaultValue: '{{count}} uses',
        defaultValue_one: '{{count}} use',
        count: maxUses,
      })
}

/** Describes how much longer an invite link keeps working, e.g. "Expires in 3 days". */
export function describeInviteLinkExpiry(
  inviteLink: Pick<ChannelInviteLinkJson, 'expiresAt'>,
  now: number,
  t: TFunction,
) {
  if (inviteLink.expiresAt === undefined) {
    return t('chat.inviteLinks.neverExpires', 'Never expires')
  } else if (inviteLink.expiresAt <= now) {
    return t('chat.inviteLinks.expired', 'Expired')
  }

  // Measured from a minute back so a link made moments ago reads as its whole chosen lifetime
  // ("in 1 hour") rather than one unit less, which rounding down to whole units would show.
  return t('chat.inviteLinks.expiresIn', {
    defaultValue: 'Expires {{timeLeft}}',
    timeLeft: timeLeftFormat.format(inviteLink.expiresAt, now - MINUTE_SECONDS * 1000),
  })
}

/** Describes an invite link's use limit, e.g. "No use limit" or "Limited to 10 uses". */
export function describeInviteLinkUseLimit(
  inviteLink: Pick<ChannelInviteLinkJson, 'maxUses'>,
  t: TFunction,
) {
  return inviteLink.maxUses === undefined
    ? t('chat.inviteLinks.noUseLimit', 'No use limit')
    : t('chat.inviteLinks.useLimit', {
        defaultValue: 'Limited to {{count}} uses',
        defaultValue_one: 'Limited to {{count}} use',
        count: inviteLink.maxUses,
      })
}

/** Describes when an invite link was created, e.g. "Created 5 minutes ago". */
export function describeInviteLinkCreated(
  inviteLink: Pick<ChannelInviteLinkJson, 'createdAt'>,
  now: number,
  t: TFunction,
) {
  return t('chat.inviteLinks.created', {
    defaultValue: 'Created {{timeAgo}}',
    timeAgo: createdAgoFormat.format(Math.min(inviteLink.createdAt, now), now),
  })
}

/** Describes how many times an invite link has been used, e.g. "3 uses" or "3 / 10 uses". */
export function describeInviteLinkUses(
  inviteLink: Pick<ChannelInviteLinkJson, 'uses' | 'maxUses'>,
  t: TFunction,
) {
  return inviteLink.maxUses === undefined
    ? t('chat.inviteLinks.uses', {
        defaultValue: '{{count}} uses',
        defaultValue_one: '{{count}} use',
        count: inviteLink.uses,
      })
    : t('chat.inviteLinks.usesOfMax', {
        defaultValue: '{{count}} / {{maxUses}} uses',
        defaultValue_one: '{{count}} / {{maxUses}} uses',
        count: inviteLink.uses,
        maxUses: inviteLink.maxUses,
      })
}
