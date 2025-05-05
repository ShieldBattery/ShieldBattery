import React, { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ChatServiceErrorCode,
  ClientChatMessageType,
  SbChannelId,
  ServerChatMessageType,
} from '../../common/chat'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { Chat } from '../messaging/chat'
import { MessageComponentProps } from '../messaging/message-list'
import { push } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { usePrevious, useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { bodyLarge, titleLarge } from '../styles/typography'
import {
  areUserEntriesEqual,
  sortUserEntries,
  useUserEntriesSelector,
} from '../users/sorted-user-ids'
import {
  activateChannel,
  correctChannelNameForChat,
  deactivateChannel,
  getChannelInfo,
  getMessageHistory,
  leaveChannel,
  retrieveUserList,
  sendMessage,
} from './action-creators'
import { ChannelContext } from './channel-context'
import { CHANNEL_HEADER_HEIGHT, ChannelHeader } from './channel-header'
import { ConnectedChannelInfoCard } from './channel-info-card'
import { ChannelMessageMenu, ChannelUserMenu } from './channel-menu-items'
import { UserList } from './channel-user-list'
import {
  BanUserMessage,
  JoinChannelMessage,
  KickUserMessage,
  LeaveChannelMessage,
  NewChannelOwnerMessage,
  SelfJoinChannelMessage,
} from './chat-message-layout'

const MESSAGES_LIMIT = 50

const BACKGROUND_MASK_GRADIENT = `
  linear-gradient(
    180deg,
    #000 52.83%,
    rgba(0, 0, 0, 0.6) 70.31%,
    rgba(0, 0, 0, 0.2) 84.37%,
    rgba(0, 0, 0, 0) 100%
  )
`

const Container = styled(CenteredContentContainer).attrs({ $targetHorizontalPadding: 16 })`
  display: flex;
  padding-top: 8px;
  gap: 8px;
`

const StyledChat = styled(Chat)`
  flex-grow: 1;
`

const StyledUserList = styled(UserList)`
  margin-bottom: 8px;
`

const BackgroundImage = styled.img`
  position: absolute;
  top: ${CHANNEL_HEADER_HEIGHT}px;
  left: 0;
  width: 100%;
  height: 400px;

  opacity: 0.2;
  object-fit: cover;
  object-position: top;
  mask-image: ${BACKGROUND_MASK_GRADIENT};
  -webkit-mask-image: ${BACKGROUND_MASK_GRADIENT};
`

export function ChannelMessage({ message }: MessageComponentProps) {
  switch (message.type) {
    case ClientChatMessageType.BanUser:
      return <BanUserMessage key={message.id} time={message.time} userId={message.userId} />
    case ClientChatMessageType.KickUser:
      return <KickUserMessage key={message.id} time={message.time} userId={message.userId} />
    case ServerChatMessageType.JoinChannel:
      return <JoinChannelMessage key={message.id} time={message.time} userId={message.userId} />
    case ClientChatMessageType.LeaveChannel:
      return <LeaveChannelMessage key={message.id} time={message.time} userId={message.userId} />
    case ClientChatMessageType.NewChannelOwner:
      return (
        <NewChannelOwnerMessage
          key={message.id}
          time={message.time}
          newOwnerId={message.newOwnerId}
        />
      )
    case ClientChatMessageType.SelfJoinChannel:
      return <SelfJoinChannelMessage key={message.id} channelId={message.channelId} />
    default:
      return null
  }
}

interface ChatChannelProps {
  channelId: SbChannelId
  channelName: string
}

export function ConnectedChatChannel({
  channelId,
  channelName: channelNameFromRoute,
}: ChatChannelProps) {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const detailedChannelInfo = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId))
  const joinedChannelInfo = useAppSelector(s => s.chat.idToJoinedInfo.get(channelId))
  const channelUsers = useAppSelector(s => s.chat.idToUsers.get(channelId))
  const channelMessages = useAppSelector(s => s.chat.idToMessages.get(channelId))
  const selfPreferences = useAppSelector(s => s.chat.idToSelfPreferences.get(channelId))
  const isInChannel = useAppSelector(s => s.chat.joinedChannels.has(channelId))

  // NOTE(2Pac): Reproducing the Discord's logic where when the user types the @ character, we show
  // the last 10 chatters in the channel as an option to mention.
  const lastTenChatters = useMemo(() => {
    const chattersSet = new Set<SbUserId>()
    const reversedMessages = channelMessages?.messages.toReversed() ?? []
    for (const message of reversedMessages) {
      if (message.type === ServerChatMessageType.TextMessage && chattersSet.size <= 10) {
        chattersSet.add(message.from)
      }
    }

    // If there are no text messages in the channel, we add the self-user as an option to mention.
    if (chattersSet.size === 0 && selfUser) {
      chattersSet.add(selfUser.id)
    }

    return Array.from(chattersSet)
  }, [channelMessages, selfUser])

  // We map the user IDs to their usernames so we can sort them by their name without pulling all of
  // the users from the store and depending on any of their changes.
  const activeUserEntries = useAppSelector(
    useUserEntriesSelector(channelUsers?.active),
    areUserEntriesEqual,
  )
  const idleUserEntries = useAppSelector(
    useUserEntriesSelector(channelUsers?.idle),
    areUserEntriesEqual,
  )
  const offlineUserEntries = useAppSelector(
    useUserEntriesSelector(channelUsers?.offline),
    areUserEntriesEqual,
  )
  const lastTenChattersEntries = useAppSelector(
    useUserEntriesSelector(lastTenChatters),
    areUserEntriesEqual,
  )

  const sortedActiveUsers = useMemo(() => sortUserEntries(activeUserEntries), [activeUserEntries])
  const sortedIdleUsers = useMemo(() => sortUserEntries(idleUserEntries), [idleUserEntries])
  const sortedOfflineUsers = useMemo(
    () => sortUserEntries(offlineUserEntries),
    [offlineUserEntries],
  )

  const prevIsInChannel = usePrevious(isInChannel)
  const prevChannelId = usePrevious(channelId)
  const isLeavingChannel = !isInChannel && prevIsInChannel && prevChannelId === channelId

  // TODO(2Pac): Pull this out into some kind of "isLeaving" hook and share with whispers/lobby?
  useEffect(() => {
    if (isLeavingChannel) {
      push('/')
    }
  }, [isLeavingChannel])

  useEffect(() => {
    if (isInChannel) {
      dispatch(retrieveUserList(channelId))
      dispatch(activateChannel(channelId))
    }

    return () => {
      dispatch(deactivateChannel(channelId))
    }
  }, [isInChannel, channelId, dispatch])

  useEffect(() => {
    if (basicChannelInfo && channelNameFromRoute !== basicChannelInfo.name) {
      correctChannelNameForChat(basicChannelInfo.id, basicChannelInfo.name)
    }
  }, [basicChannelInfo, channelNameFromRoute])

  const onLoadMoreMessages = useStableCallback(() =>
    dispatch(getMessageHistory(channelId, MESSAGES_LIMIT)),
  )

  const onSendChatMessage = useStableCallback((msg: string) =>
    dispatch(sendMessage(channelId, msg)),
  )

  const onLeaveChannel = useStableCallback((channelId: SbChannelId) => {
    dispatch(leaveChannel(channelId))
  })

  return (
    <Container>
      <ChannelContext.Provider value={{ channelId }}>
        {isInChannel || isLeavingChannel ? (
          <StyledChat
            listProps={{
              messages: channelMessages?.messages ?? [],
              loading: channelMessages?.loadingHistory,
              hasMoreHistory: channelMessages?.hasHistory,
              refreshToken: channelId,
              MessageComponent: ChannelMessage,
              onLoadMoreMessages,
            }}
            inputProps={{
              onSendChatMessage,
              storageKey: `chat.${channelId}`,
              mentionableUsers: activeUserEntries
                .concat(idleUserEntries)
                .concat(offlineUserEntries)
                .concat([
                  [makeSbUserId(123), 'Test User'],
                  [makeSbUserId(124), 'Test User 2'],
                  [makeSbUserId(125), 'Test User 3'],
                  [makeSbUserId(126), 'Test User 4'],
                  [makeSbUserId(127), 'Test User 5'],
                  [makeSbUserId(128), 'Test User 6'],
                  [makeSbUserId(129), 'Test User 7'],
                  [makeSbUserId(130), 'Test User 8'],
                  [makeSbUserId(131), 'Test User 9'],
                  [makeSbUserId(132), 'Test User 10'],
                  [makeSbUserId(133), 'Test User 11'],
                  [makeSbUserId(134), 'Test User 12'],
                  [makeSbUserId(135), 'Test User 13'],
                  [makeSbUserId(136), 'Test User 14'],
                  [makeSbUserId(137), 'Test User 15'],
                  [makeSbUserId(138), 'Test User 16'],
                  [makeSbUserId(139), 'Test User 17'],
                  [makeSbUserId(140), 'Test User 18'],
                  [makeSbUserId(141), 'Test User 19'],
                  [makeSbUserId(142), 'Test User 20'],
                  [makeSbUserId(143), 'Test User 21'],
                  [makeSbUserId(144), 'Test User 22'],
                  [makeSbUserId(145), 'Test User 23'],
                  [makeSbUserId(146), 'Test User 24'],
                  [makeSbUserId(147), 'Test User 25'],
                  [makeSbUserId(148), 'Test User 26'],
                  [makeSbUserId(149), 'Test User 27'],
                  [makeSbUserId(150), 'Test User 28'],
                  [makeSbUserId(151), 'Test User 29'],
                  [makeSbUserId(152), 'Test User 30'],
                  [makeSbUserId(153), 'Test User 31'],
                  [makeSbUserId(154), 'Test User 32'],
                  [makeSbUserId(155), 'Test User 33'],
                ])
                .filter(([id, username]) => username !== undefined)
                .map(([id, username]) => ({ id, name: username! })),
              defaultMentionableUsers: lastTenChattersEntries
                .filter(([id, username]) => username !== undefined)
                .map(([id, username]) => ({ id, name: username! })),
            }}
            header={
              // These are basically guaranteed to be defined here, but still doing the check instead
              // of asserting them with ! because better to be safe than sorry, or something.
              basicChannelInfo && detailedChannelInfo && joinedChannelInfo && selfPreferences ? (
                <ChannelHeader
                  key={basicChannelInfo.id}
                  basicChannelInfo={basicChannelInfo}
                  detailedChannelInfo={detailedChannelInfo}
                  joinedChannelInfo={joinedChannelInfo}
                  selfPreferences={selfPreferences}
                  onLeaveChannel={onLeaveChannel}
                />
              ) : null
            }
            backgroundContent={
              !selfPreferences?.hideBanner && detailedChannelInfo?.bannerPath ? (
                <BackgroundImage src={detailedChannelInfo.bannerPath} draggable={false} />
              ) : undefined
            }
            extraContent={
              <StyledUserList
                active={sortedActiveUsers}
                idle={sortedIdleUsers}
                offline={sortedOfflineUsers}
              />
            }
            UserMenu={ChannelUserMenu}
            MessageMenu={ChannelMessageMenu}
          />
        ) : (
          <ChannelInfoPage channelId={channelId} channelName={channelNameFromRoute} />
        )}
      </ChannelContext.Provider>
    </Container>
  )
}

const ChannelInfoContainer = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  justify-content: center;
  align-items: center;
`

const ErrorContainer = styled.div`
  display: flex;
  flex-direction: column;
  max-width: 480px;
  margin: 0 32px;
`

const ChannelName = styled.div`
  ${titleLarge};
  margin-bottom: 8px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

function ChannelInfoPage({
  channelId,
  channelName,
}: {
  channelId: SbChannelId
  channelName: string
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error>()

  useEffect(() => {
    const abortController = new AbortController()

    setIsLoading(true)
    dispatch(
      getChannelInfo(channelId, {
        signal: abortController.signal,
        onSuccess: () => {
          setIsLoading(false)
          setError(undefined)
        },
        onError: err => {
          setIsLoading(false)
          setError(err)
        },
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [channelId, dispatch])

  let contents
  if (isLoading) {
    contents = <LoadingDotsArea />
  } else if (error) {
    let errorText
    if (isFetchError(error)) {
      if (error.code === ChatServiceErrorCode.ChannelNotFound) {
        errorText = (
          <ErrorText>
            {t(
              'chat.channelInfo.notFound',
              'This channel could not be found. It might not exist, or it may have been ' +
                're-created by someone else.',
            )}
          </ErrorText>
        )
      } else {
        errorText = (
          <ErrorText>
            <Trans t={t} i18nKey='chat.channelInfo.defaultError'>
              An error occurred: {{ statusText: error.statusText }}
            </Trans>
          </ErrorText>
        )
      }
    } else {
      errorText = (
        <ErrorText>
          <Trans t={t} i18nKey='chat.channelInfo.genericError'>
            Error getting channel info for #{{ channelName }}: {{ errorMessage: error.message }}
          </Trans>
        </ErrorText>
      )
    }
    contents = (
      <ErrorContainer>
        <ChannelName>{channelName}</ChannelName>
        {errorText}
      </ErrorContainer>
    )
  } else if (basicChannelInfo) {
    contents = (
      <ConnectedChannelInfoCard
        channelId={basicChannelInfo.id}
        channelName={basicChannelInfo.name}
      />
    )
  }

  return <ChannelInfoContainer>{contents}</ChannelInfoContainer>
}
