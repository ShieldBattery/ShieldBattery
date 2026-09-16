import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { assertUnreachable } from '../../../../common/assert-unreachable'
import { SbChannelId } from '../../../../common/chat'
import { FriendActivityStatus } from '../../../../common/users/relationships'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { ConnectedChannelName } from '../../../chat/connected-channel-name'
import { ConnectedUsername } from '../../../users/connected-username'
import { ALL_COMMAND_SURFACES, defineCommand } from '../command-schema'
import { LocalStrong } from '../local-strong'
import { resolveTarget } from './user-card'

/** How present a user is in one channel, as that channel's member list has it. */
type ChannelPresence = 'active' | 'idle' | 'offline'

interface ChannelPresenceEntry {
  channelId: SbChannelId
  presence: ChannelPresence
}

/**
 * What the answer says the user is doing. `self` and `unknown` are the two cases the activity
 * statuses don't cover: the user asking about themselves, and a user nothing is visible about.
 */
type WhoisStatus = 'self' | 'unknown' | FriendActivityStatus

function getPresenceWord(presence: ChannelPresence, t: TFunction): string {
  switch (presence) {
    case 'active':
      return t('chat.commands.whois.presence.active', 'active')
    case 'idle':
      return t('chat.commands.whois.presence.idle', 'idle')
    case 'offline':
      return t('chat.commands.whois.presence.offline', 'offline')
    default:
      return assertUnreachable(presence)
  }
}

function getStatusSentence(userId: SbUserId, status: WhoisStatus, t: TFunction): React.ReactNode {
  switch (status) {
    case 'self':
      return (
        <Trans t={t} i18nKey='chat.commands.whois.self'>
          You are{' '}
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>
          .
        </Trans>
      )
    case FriendActivityStatus.InLobby:
      return (
        <Trans t={t} i18nKey='chat.commands.whois.inLobby'>
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>{' '}
          is in a lobby.
        </Trans>
      )
    case FriendActivityStatus.InQueue:
      return (
        <Trans t={t} i18nKey='chat.commands.whois.inQueue'>
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>{' '}
          is in the matchmaking queue.
        </Trans>
      )
    case FriendActivityStatus.InGame:
      return (
        <Trans t={t} i18nKey='chat.commands.whois.inGame'>
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>{' '}
          is in a game.
        </Trans>
      )
    case FriendActivityStatus.Online:
      return (
        <Trans t={t} i18nKey='chat.commands.whois.online'>
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>{' '}
          is online.
        </Trans>
      )
    case FriendActivityStatus.Offline:
      return (
        <Trans t={t} i18nKey='chat.commands.whois.offline'>
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>{' '}
          is offline.
        </Trans>
      )
    case 'unknown':
      return (
        <Trans t={t} i18nKey='chat.commands.whois.unknown'>
          Can't tell what{' '}
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>{' '}
          is doing: only friends and members of your channels share their status.
        </Trans>
      )
    default:
      return assertUnreachable(status)
  }
}

/** The channels the user shares with the caller and how present they are in each, or nothing. */
function getChannelsClause(
  entries: ReadonlyArray<ChannelPresenceEntry>,
  t: TFunction,
): React.ReactNode {
  if (!entries.length) {
    return undefined
  }

  return (
    <>
      {' '}
      <Trans t={t} i18nKey='chat.commands.whois.channelsLabel'>
        Channels:
      </Trans>{' '}
      {entries.map((entry, i) => (
        <React.Fragment key={entry.channelId}>
          {i > 0 ? ', ' : undefined}
          <LocalStrong>
            <ConnectedChannelName channelId={entry.channelId} />
          </LocalStrong>{' '}
          ({getPresenceWord(entry.presence, t)})
        </React.Fragment>
      ))}
      .
    </>
  )
}

/**
 * Says what a user is doing, using only what the client has already been told about them, which is
 * also the boundary of what the user has agreed to share. A friend's status comes from the
 * friend-only activity feed, so it can name a lobby, a queue or a game. For anyone else the only
 * signal is per-channel presence, which every member of a channel already sees, so a non-friend's
 * answer never says more than whether they are around and which shared channels they are in.
 */
export const whoisCommand = defineCommand({
  name: 'whois',
  aliases: ['where', 'whereis'],
  description: t =>
    t('chat.commands.whois.description', 'Shows what a user is doing, as far as you can see.'),
  group: 'people',
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'user', name: 'user', optional: true }],

  run(invocation) {
    const { context, dispatch, t, emit } = invocation

    resolveTarget(invocation.args.user, invocation, target => {
      dispatch((_, getState) => {
        const { chat, relationships } = getState()

        // Only a channel whose member list has been loaded can say anything about who isn't in it,
        // so a channel that hasn't loaded one is no evidence either way.
        const entries: ChannelPresenceEntry[] = []
        for (const [channelId, users] of chat.idToUsers) {
          if (!users.hasLoadedUserList || !chat.idToBasicInfo.has(channelId)) {
            continue
          }

          if (users.active.has(target.id)) {
            entries.push({ channelId, presence: 'active' })
          } else if (users.idle.has(target.id)) {
            entries.push({ channelId, presence: 'idle' })
          } else if (users.offline.has(target.id)) {
            entries.push({ channelId, presence: 'offline' })
          }
        }

        let status: WhoisStatus
        if (target.id === context.selfUserId) {
          status = 'self'
        } else if (relationships.friends.has(target.id)) {
          status = relationships.friendActivityStatus.get(target.id) ?? FriendActivityStatus.Offline
        } else if (entries.length) {
          status = entries.some(entry => entry.presence !== 'offline')
            ? FriendActivityStatus.Online
            : FriendActivityStatus.Offline
        } else {
          status = 'unknown'
        }

        emit({
          kind: 'info',
          content: (
            <>
              {getStatusSentence(target.id, status, t)}
              {getChannelsClause(entries, t)}
            </>
          ),
        })
      })
    })
  },
})
