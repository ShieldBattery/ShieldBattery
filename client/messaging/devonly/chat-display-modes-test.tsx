import styled from 'styled-components'
import { makeSbChannelId, ServerChatMessageType } from '../../../common/chat'
import { ChatDisplayMode } from '../../../common/settings/account-settings'
import { DEFAULT_PERMISSIONS } from '../../../common/users/permissions'
import { SbUser, SelfUserJson } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { ReduxAction } from '../../action-types'
import { ChannelMessage } from '../../chat/channel'
import { IsolatedReduxProvider } from '../../lobbies/devonly/isolated-redux'
import { titleMedium } from '../../styles/typography'
import { MessageList } from '../message-list'
import { SbMessage } from '../message-records'

const CHANNEL_ID = makeSbChannelId(1)

const VIEWER = makeSbUserId(90100)
const PACHI = makeSbUserId(90101)
const DRONEBRO = makeSbUserId(90102)
const HEARTCUTTER = makeSbUserId(90103)

const VIEWER_USER: SelfUserJson = {
  id: VIEWER,
  name: 'devViewer',
  created: 0,
  loginName: 'devViewer',
  email: 'devviewer@example.com',
  emailVerified: true,
  acceptedPrivacyVersion: 0,
  acceptedTermsVersion: 0,
  acceptedUsePolicyVersion: 0,
  nameChangeTokens: 0,
}

const AUTHORS: SbUser[] = [
  { id: PACHI, name: 'Pachi', created: 0, staffBadge: true },
  { id: DRONEBRO, name: 'dronebro', created: 0 },
  { id: HEARTCUTTER, name: 'HeartcutterXVIII', created: 0 },
]

const SEED_ACTIONS: ReadonlyArray<ReduxAction> = [
  {
    type: '@auth/loadCurrentSession',
    payload: { user: VIEWER_USER, permissions: { ...DEFAULT_PERMISSIONS }, jwt: '' },
  },
  { type: '@users/loadUsers', payload: AUTHORS },
]

/** Late in the evening, so the fixture crosses into a new day partway through. */
const START = new Date(2026, 8, 24, 23, 40).getTime()
const SECOND = 1000
const MINUTE = 60 * SECOND

let nextId = 0

function text(from: SbUserId, offset: number, body: string, emote?: boolean): SbMessage {
  nextId += 1
  return {
    id: `display-mode-${nextId}`,
    type: ServerChatMessageType.TextMessage,
    channelId: CHANNEL_ID,
    time: START + offset,
    from,
    text: body,
    emote,
  }
}

const MESSAGES: ReadonlyArray<SbMessage> = [
  text(PACHI, 0, 'gl hf everyone'),
  text(PACHI, 20 * SECOND, 'anyone up for a 2v2 on Fighting Spirit?'),
  text(PACHI, 45 * SECOND, 'need a zerg partner'),
  text(DRONEBRO, 1 * MINUTE, 'sure, give me a sec to finish this replay'),
  text(DRONEBRO, 1 * MINUTE + 20 * SECOND, 'stretches', true),
  text(DRONEBRO, 1 * MINUTE + 40 * SECOND, 'ok ready'),
  text(DRONEBRO, 8 * MINUTE, 'anyone still around?'),
  {
    id: 'display-mode-join',
    type: ServerChatMessageType.JoinChannel,
    channelId: CHANNEL_ID,
    time: START + 9 * MINUTE,
    userId: HEARTCUTTER,
  },
  text(PACHI, 21 * MINUTE, 'happy new day'),
  text(PACHI, 21 * MINUTE + 20 * SECOND, `<@${VIEWER}> you in?`),
  text(PACHI, 22 * MINUTE, 'vod from last night: https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
  text(PACHI, 22 * MINUTE + 10 * SECOND, '🔥🔥 🎉'),
  text(
    HEARTCUTTER,
    23 * MINUTE,
    'this is a really long message that keeps going well past the width of the column, so it ' +
      'has to wrap onto a second line and maybe even a third one, which shows where wrapped ' +
      'text lines up relative to the name and the gutter in each display mode',
  ),
]

/** The read position, placed after the self-mention so the unread line splits a group. */
const UNREAD_LINE_TIME = START + 21 * MINUTE + 20 * SECOND

const PageRoot = styled.div`
  padding: 16px;

  display: flex;
  align-items: flex-start;
  gap: 24px;
`

const Column = styled.div`
  width: 600px;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Caption = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface-variant);
`

const ListFrame = styled.div`
  height: 720px;

  background-color: var(--theme-container-low);
  border-radius: 8px;
`

const StyledMessageList = styled(MessageList)`
  height: 100%;
`

function DisplayModeColumn({ mode, caption }: { mode: ChatDisplayMode; caption: string }) {
  return (
    <Column>
      <Caption>{caption}</Caption>
      <ListFrame>
        <StyledMessageList
          messages={MESSAGES}
          MessageComponent={ChannelMessage}
          unreadLineTime={UNREAD_LINE_TIME}
          displayMode={mode}
        />
      </ListFrame>
    </Column>
  )
}

export function ChatDisplayModesTest() {
  return (
    <IsolatedReduxProvider seedActions={SEED_ACTIONS}>
      <PageRoot>
        <DisplayModeColumn mode='classic' caption='Classic' />
        <DisplayModeColumn mode='cozy' caption='Cozy' />
      </PageRoot>
    </IsolatedReduxProvider>
  )
}
