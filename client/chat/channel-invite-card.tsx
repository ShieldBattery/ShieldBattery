import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GetChannelInviteLinkResponse, SbChannelId } from '../../common/chat'
import { isPrettyId } from '../../common/pretty-id'
import { apiUrl } from '../../common/urls'
import { BackdropCardGone, BackdropCardLoading } from '../messaging/backdrop-card'
import { shieldBatteryPathFromLink } from '../navigation/external-link'
import { fetchJson } from '../network/fetch'
import { FetchBudget } from '../network/fetch-budget'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import {
  getJoinChannelErrorMessage,
  joinChannelWithInviteLink,
  navigateToChannel,
} from './action-creators'
import { CHANNEL_PREVIEW_CARD_HEIGHT, ChannelPreviewCard } from './channel-preview-card'
import { channelInviteTokenFromPath } from './channel-url'

/**
 * Returns the token of the private channel invite link a chat message link is, or undefined if the
 * link isn't a ShieldBattery invite link (an external URL, or a ShieldBattery URL for something
 * other than an invite).
 */
export function channelInviteTokenFromMessageLink(href: string): string | undefined {
  const pathname = shieldBatteryPathFromLink(href)
  return pathname !== undefined ? channelInviteTokenFromPath(pathname) : undefined
}

/**
 * What looking up an invite link came to: what it leads into, that it doesn't lead anywhere (it
 * doesn't exist, expired, was used up, or its channel isn't private anymore), or that it couldn't
 * be looked up right now (a transient failure, or the fetch budget below was spent).
 */
export type ChannelInviteLoadState =
  | { status: 'loaded'; info: GetChannelInviteLinkResponse }
  | { status: 'invalid' }
  | { status: 'error' }

/**
 * Invite link lookups that are in flight or have settled, shared by every card showing the same
 * link. A transient failure is evicted so a later card retries; anything else stays for the
 * session, since whether the viewer is a member is read from the chat store rather than from here.
 */
const inviteLinkFetches = new Map<string, Promise<ChannelInviteLoadState>>()

/**
 * How many invite link lookups rendered links may start per window. Message text is
 * sender-controlled, so a history page full of distinct invite links must not be able to fan out one
 * request each against the lookup's per-user throttle, which is deliberately tight to keep tokens
 * from being guessed at.
 */
const inviteLinkFetchBudget = new FetchBudget(10, 30 * 1000)

/**
 * Looks up what an invite link leads into. `direct` marks a lookup the user asked for themselves
 * (opening the link's page), which isn't counted against the budget for links in messages.
 */
function loadChannelInvite(token: string, direct: boolean): Promise<ChannelInviteLoadState> {
  const existing = inviteLinkFetches.get(token)
  if (existing) {
    return existing
  }

  if (!isPrettyId(token)) {
    return Promise.resolve({ status: 'invalid' })
  }
  if (!direct && !inviteLinkFetchBudget.take()) {
    // Not cached, so a denied card that remounts tries again against whatever budget exists then.
    // Until then it renders nothing, while its message's inline link keeps working.
    return Promise.resolve({ status: 'error' })
  }

  const promise = fetchJson<GetChannelInviteLinkResponse>(apiUrl`chat/invite-links/${token}`).then(
    (info): ChannelInviteLoadState => ({ status: 'loaded', info }),
    (err): ChannelInviteLoadState => {
      if (isFetchError(err) && err.status === 404) {
        return { status: 'invalid' }
      }
      inviteLinkFetches.delete(token)
      return { status: 'error' }
    },
  )
  inviteLinkFetches.set(token, promise)
  return promise
}

/** Returns what an invite link leads into, or undefined while that's being looked up. */
function useChannelInviteState(token: string, direct: boolean): ChannelInviteLoadState | undefined {
  const [settled, setSettled] = useState<{ token: string; state: ChannelInviteLoadState }>()

  useEffect(() => {
    // The lookup is shared across every card showing this link, so it can't be aborted just
    // because this card goes away -- only ignore a result that arrives after that happens.
    let canceled = false
    loadChannelInvite(token, direct)
      .then(state => {
        if (!canceled) {
          setSettled({ token, state })
        }
      })
      .catch(swallowNonBuiltins)

    return () => {
      canceled = true
    }
  }, [token, direct])

  return settled?.token === token ? settled.state : undefined
}

/**
 * The presentational part of {@link ChannelInviteCard}: renders the loading/invalid/error/loaded
 * states without looking anything up itself, so it can be driven directly (e.g. from a devonly
 * test page).
 *
 * The loading state renders a placeholder the loaded card's height, so the message it's attached
 * to doesn't grow once the lookup settles. The error state renders nothing: the inline link in the
 * message text still works, and shrinking away is safe (only growth breaks the message list's
 * autoscroll).
 */
export function ChannelInviteCardContent({
  state,
  isMember,
  onViewClick,
  onJoinClick,
}: {
  state: ChannelInviteLoadState | undefined
  /** Whether the viewer is already in the channel, which swaps joining it for opening it. */
  isMember: boolean
  onViewClick: () => void
  onJoinClick: () => void
}) {
  const { t } = useTranslation()

  if (!state) {
    return <BackdropCardLoading $height={CHANNEL_PREVIEW_CARD_HEIGHT} aria-hidden={true} />
  }

  if (state.status === 'error') {
    return null
  }

  if (state.status === 'invalid') {
    return (
      <BackdropCardGone>
        {t('chat.inviteCard.invalid', 'This invite link is invalid or has expired.')}
      </BackdropCardGone>
    )
  }

  const { channelInfo, detailedChannelInfo } = state.info

  return (
    <ChannelPreviewCard
      title={t('chat.inviteCard.title', 'Private channel')}
      channelName={channelInfo.name}
      bannerPath={detailedChannelInfo.bannerPath}
      badgePath={detailedChannelInfo.badgePath}
      userCount={detailedChannelInfo.userCount}
      description={detailedChannelInfo.description}
      isMember={isMember}
      onViewClick={onViewClick}
      onJoinClick={onJoinClick}
      testName='channel-invite-card'
    />
  )
}

/**
 * A preview of the private channel an invite link leads into, from which the viewer can join it
 * (or open it, if they're already in it). Joining moves the viewer into the channel.
 *
 * `direct` marks a card the user opened themselves (the invite link's own page) rather than one
 * rendered for a link in a message, see {@link loadChannelInvite}.
 */
export function ChannelInviteCard({ token, direct = false }: { token: string; direct?: boolean }) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const state = useChannelInviteState(token, direct)
  const info = state?.status === 'loaded' ? state.info : undefined
  const channelId: SbChannelId | undefined = info?.channelInfo.id
  const isMember = useAppSelector(s =>
    channelId !== undefined ? s.chat.joinedChannels.has(channelId) : false,
  )
  const [joining, setJoining] = useState(false)

  return (
    <ChannelInviteCardContent
      state={state}
      isMember={isMember}
      onViewClick={() => {
        if (info) {
          navigateToChannel(info.channelInfo.id, info.channelInfo.name)
        }
      }}
      onJoinClick={() => {
        if (!info || joining) {
          return
        }

        setJoining(true)
        dispatch(
          joinChannelWithInviteLink(token, {
            onSuccess: () => setJoining(false),
            onError: err => {
              setJoining(false)
              snackbarController.showSnackbar(
                getJoinChannelErrorMessage(err, info.channelInfo.name),
                DURATION_LONG,
              )
            },
          }),
        )
      }}
    />
  )
}
