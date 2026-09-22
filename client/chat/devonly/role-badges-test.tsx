import { useState } from 'react'
import styled from 'styled-components'
import {
  ChannelTextMessage,
  DEFAULT_CHANNEL_PREFERENCES,
  InitialChannelData,
  makeSbChannelId,
  ServerChatMessageType,
} from '../../../common/chat'
import { DEFAULT_PERMISSIONS } from '../../../common/users/permissions'
import { FriendActivityStatus } from '../../../common/users/relationships'
import { SbUser, SelfUserJson } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { ReduxAction } from '../../action-types'
import { IsolatedReduxProvider } from '../../lobbies/devonly/isolated-redux'
import { FilledButton } from '../../material/button'
import { ChatContext } from '../../messaging/chat-context'
import { DefaultMessageMenu } from '../../messaging/message-context-menu'
import { MessageList } from '../../messaging/message-list'
import { useAppDispatch } from '../../redux-hooks'
import { bodyMedium, titleLarge } from '../../styles/typography'
import { LiveUsersContext } from '../../twitch/live-state'
import { ChannelMessage } from '../channel'
import { ChannelContext } from '../channel-context'
import { MessageRoleBadge } from '../channel-role-badge'
import { UserList } from '../channel-user-list'

// Ids well clear of the ones a development database hands out, so background fetches for the real
// holders of low ids can't overwrite these fixtures.
const CHANNEL_ID = makeSbChannelId(987654)

const OWNER = makeSbUserId(900001)
const MODERATOR = makeSbUserId(900002)
const LONG_NAME_MODERATOR = makeSbUserId(900003)
const MEMBER = makeSbUserId(900004)
const SHORT_NAME_MEMBER = makeSbUserId(900005)
const VIEWER = makeSbUserId(900006)

const USERS: SbUser[] = [
  { id: OWNER, name: 'ChannelFounder', created: 0 },
  { id: MODERATOR, name: 'Pachi', created: 0 },
  { id: LONG_NAME_MODERATOR, name: 'VeryLongModeratorNameThatOverflows', created: 0 },
  { id: MEMBER, name: 'dronebro', created: 0 },
  { id: SHORT_NAME_MEMBER, name: 'ta', created: 0 },
  { id: VIEWER, name: 'devViewer', created: 0 },
]

const ROSTER = {
  active: [OWNER, MODERATOR, LONG_NAME_MODERATOR, VIEWER],
  idle: [MEMBER],
  offline: [SHORT_NAME_MEMBER],
}

const LIVE_USERS: ReadonlySet<SbUserId> = new Set([MODERATOR, LONG_NAME_MODERATOR])

const now = Date.now()

function textMessage(
  id: string,
  from: SbUserId,
  text: string,
  minutesAgo: number,
  emote?: boolean,
): ChannelTextMessage {
  return {
    id,
    type: ServerChatMessageType.TextMessage,
    channelId: CHANNEL_ID,
    time: now - minutesAgo * 60_000,
    from,
    text,
    emote,
  }
}

const MESSAGES: ChannelTextMessage[] = [
  textMessage('msg-1', OWNER, 'Welcome in, the ladder cup starts in ten minutes.', 9),
  textMessage('msg-2', MODERATOR, 'Brackets are up, sign-ups close at the hour.', 7),
  textMessage('msg-3', MEMBER, 'is there a map pool for this one?', 5),
  textMessage(
    'msg-4',
    LONG_NAME_MODERATOR,
    'Same pool as last week, plus Neo Sylphid replacing Circuit Breaker.',
    4,
  ),
  textMessage('msg-5', SHORT_NAME_MEMBER, 'gl all', 3),
  textMessage('msg-6', OWNER, 'wishes everyone good luck', 1, true),
]

function makeSelfUser(user: SbUser): SelfUserJson {
  return {
    id: user.id,
    name: user.name,
    created: 0,
    loginName: user.name,
    email: `${user.name}@example.com`,
    emailVerified: true,
    acceptedPrivacyVersion: 0,
    acceptedTermsVersion: 0,
    acceptedUsePolicyVersion: 0,
    nameChangeTokens: 0,
  }
}

function initialChannelData(moderatorIds: SbUserId[]): InitialChannelData {
  return {
    channelInfo: { id: CHANNEL_ID, name: 'role-badges', private: false, official: false },
    detailedChannelInfo: { id: CHANNEL_ID, userCount: USERS.length },
    joinedChannelInfo: { id: CHANNEL_ID, ownerId: OWNER },
    selfPreferences: { ...DEFAULT_CHANNEL_PREFERENCES },
    selfPermissions: {
      kick: false,
      ban: false,
      changeTopic: false,
      togglePrivate: false,
      editPermissions: false,
    },
    moderatorIds,
  }
}

/**
 * Everything the page-local store needs before its first render: a logged-in viewer (message lists
 * render nothing without one), the fixture users, and the channel with its roles and roster.
 */
const SEED_ACTIONS: ReduxAction[] = [
  {
    type: '@auth/loadCurrentSession',
    payload: {
      user: makeSelfUser(USERS.find(u => u.id === VIEWER)!),
      permissions: { ...DEFAULT_PERMISSIONS },
      jwt: '',
    },
  },
  {
    type: '@users/loadUsers',
    payload: USERS,
  },
  {
    type: '@chat/getJoinedChannels',
    payload: [initialChannelData([MODERATOR, LONG_NAME_MODERATOR])],
  },
  {
    type: '@chat/initActiveUsers',
    payload: { action: 'initActiveUsers', activeUserIds: ROSTER.active },
    meta: { channelId: CHANNEL_ID },
  },
  {
    type: '@users/updateFriendActivityStatus',
    payload: { userId: MODERATOR, status: FriendActivityStatus.InGame },
  },
  {
    type: '@users/updateFriendActivityStatus',
    payload: { userId: LONG_NAME_MODERATOR, status: FriendActivityStatus.InLobby },
  },
]

const Root = styled.div`
  padding: 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Note = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const SectionTitle = styled.div`
  ${titleLarge};
  margin-top: 16px;
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const Columns = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 32px;
`

const RosterColumn = styled(UserList)`
  width: 256px;
  height: 480px;
  flex-shrink: 0;
`

const MessageColumn = styled.div`
  flex: 1 1 0;
  min-width: 0;
  height: 480px;

  display: flex;
  background-color: var(--theme-container-low);
  border-radius: 8px;
`

const FillingMessageList = styled(MessageList)`
  flex: 1 1 0;
  min-width: 0;
`

export function RoleBadgesTest() {
  return (
    <IsolatedReduxProvider seedActions={SEED_ACTIONS}>
      <RoleBadgesTestInner />
    </IsolatedReduxProvider>
  )
}

function RoleBadgesTestInner() {
  const dispatch = useAppDispatch()
  const [memberIsModerator, setMemberIsModerator] = useState(false)

  const onTransferOwnership = () => {
    dispatch({
      type: '@chat/ownerChanged',
      payload: { action: 'ownerChanged', newOwnerId: MODERATOR },
      meta: { channelId: CHANNEL_ID, windowFocused: true },
    })
  }

  const onToggleModerator = () => {
    const isModerator = !memberIsModerator
    setMemberIsModerator(isModerator)
    dispatch({
      type: '@chat/userProfileChanged',
      payload: { action: 'userProfileChanged', userId: MEMBER, isModerator },
      meta: { channelId: CHANNEL_ID },
    })
  }

  const onKickModerator = () => {
    dispatch({
      type: '@chat/updateKick',
      payload: { action: 'kick', targetId: MODERATOR, channelName: 'role-badges' },
      meta: { channelId: CHANNEL_ID, windowFocused: true },
    })
  }

  return (
    <LiveUsersContext.Provider value={LIVE_USERS}>
      <ChannelContext.Provider value={{ channelId: CHANNEL_ID }}>
        <ChatContext.Provider
          value={{ MessageMenu: DefaultMessageMenu, NameBadge: MessageRoleBadge }}>
          <Root>
            <Note>
              A fixture channel seeded into a page-local store: ChannelFounder owns it, Pachi and
              VeryLongModeratorNameThatOverflows hold moderation permissions, everyone else is an
              ordinary member. The roster and the message list are the real components reading the
              real reducers; the roster's membership is fixed here, so the buttons below change who
              wears a badge without adding or removing rows.
            </Note>

            <SectionTitle>Live updates</SectionTitle>
            <Controls>
              <FilledButton
                label='Transfer ownership to Pachi'
                onClick={onTransferOwnership}
                testName='transfer-ownership'
              />
              <FilledButton
                label={memberIsModerator ? 'Demote dronebro' : 'Promote dronebro to moderator'}
                onClick={onToggleModerator}
                testName='toggle-moderator'
              />
              <FilledButton
                label='Kick Pachi'
                onClick={onKickModerator}
                testName='kick-moderator'
              />
            </Controls>

            <SectionTitle>Member list and messages</SectionTitle>
            <Columns>
              <RosterColumn active={ROSTER.active} idle={ROSTER.idle} offline={ROSTER.offline} />
              <MessageColumn>
                <FillingMessageList messages={MESSAGES} MessageComponent={ChannelMessage} />
              </MessageColumn>
            </Columns>
          </Root>
        </ChatContext.Provider>
      </ChannelContext.Provider>
    </LiveUsersContext.Provider>
  )
}
