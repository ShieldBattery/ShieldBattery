import React, { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ChatServiceErrorCode,
  ClientChatMessageType,
  SbChannelId,
  ServerChatMessageType,
} from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user-id'
import { Chat } from '../messaging/chat'
import { MAX_MENTIONED_USERS } from '../messaging/message-input'
import { MessageComponentProps } from '../messaging/message-list'
import { push } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { usePrevious, useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { bodyLarge, titleLarge } from '../styles/typography'
import { areUserEntriesEqual, useUserEntriesSelector } from '../users/user-entries'
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
import { ConnectedChannelSettings } from './channel-settings/channel-settings'
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
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const detailedChannelInfo = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId))
  const joinedChannelInfo = useAppSelector(s => s.chat.idToJoinedInfo.get(channelId))
  const channelUsers = useAppSelector(s => s.chat.idToUsers.get(channelId))
  const channelMessages = useAppSelector(s => s.chat.idToMessages.get(channelId))
  const selfPreferences = useAppSelector(s => s.chat.idToSelfPreferences.get(channelId))
  const isInChannel = useAppSelector(s => s.chat.joinedChannels.has(channelId))

  // NOTE(2Pac): When user types the single @ character in chat, we show the ten most recent
  // chatters in the channel as an option to mention.
  const recentChatters = useMemo(() => {
    const chattersSet = new Set<SbUserId>()
    const reversedMessages = channelMessages?.messages.toReversed() ?? []
    for (const message of reversedMessages) {
      if (chattersSet.size >= MAX_MENTIONED_USERS) {
        break
      }

      if (message.type === ServerChatMessageType.TextMessage) {
        chattersSet.add(message.from)
      }
    }

    return Array.from(chattersSet)
  }, [channelMessages])

  // We map the user IDs to their usernames so we can sort them by their name without pulling all of
  // the users from the store and depending on any of their changes.
  const sortedActiveUserEntries = useAppSelector(
    useUserEntriesSelector(channelUsers?.active),
    areUserEntriesEqual,
  )
  const sortedIdleUserEntries = useAppSelector(
    useUserEntriesSelector(channelUsers?.idle),
    areUserEntriesEqual,
  )
  const sortedOfflineUserEntries = useAppSelector(
    useUserEntriesSelector(channelUsers?.offline),
    areUserEntriesEqual,
  )
  const sortedRecentChattersEntries = useAppSelector(
    useUserEntriesSelector(recentChatters),
    areUserEntriesEqual,
  )

  const mentionableUsers = useMemo(() => {
    const onlineUsers = sortedActiveUserEntries
      .concat(sortedIdleUserEntries)
      .filter(([_, username]) => username !== undefined)
      .map(([id, username]) => ({ id, name: username!, online: true }))
    const offlineUsers = sortedOfflineUserEntries
      .filter(([_, username]) => username !== undefined)
      .map(([id, username]) => ({ id, name: username!, online: false }))

    return onlineUsers.concat(offlineUsers)
  }, [sortedActiveUserEntries, sortedIdleUserEntries, sortedOfflineUserEntries])

  const baseMentionableUsers = useMemo(() => {
    const onlineRecentChatters = sortedRecentChattersEntries
      .filter(([id]) => channelUsers?.active.has(id) || channelUsers?.idle.has(id))
      .filter(([_, username]) => username !== undefined)
      .map(([id, username]) => ({ id, name: username!, online: true }))
    const offlineRecentChatters = sortedRecentChattersEntries
      .filter(([id]) => channelUsers?.offline.has(id))
      .filter(([_, username]) => username !== undefined)
      .map(([id, username]) => ({ id, name: username!, online: false }))

    return onlineRecentChatters.concat(offlineRecentChatters)
  }, [channelUsers?.active, channelUsers?.idle, channelUsers?.offline, sortedRecentChattersEntries])

  const sortedActiveUserIds = useMemo(
    () => sortedActiveUserEntries.map(([id]) => id),
    [sortedActiveUserEntries],
  )
  const sortedIdleUserIds = useMemo(
    () => sortedIdleUserEntries.map(([id]) => id),
    [sortedIdleUserEntries],
  )
  const sortedOfflineUserIds = useMemo(
    () => sortedOfflineUserEntries.map(([id]) => id),
    [sortedOfflineUserEntries],
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
              mentionableUsers,
              baseMentionableUsers,
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
                active={sortedActiveUserIds}
                idle={sortedIdleUserIds}
                offline={sortedOfflineUserIds}
              />
            }
            UserMenu={ChannelUserMenu}
            MessageMenu={ChannelMessageMenu}
          />
        ) : (
          <ChannelInfoPage channelId={channelId} channelName={channelNameFromRoute} />
        )}

        <React.Suspense fallback={<LoadingDotsArea />}>
          <ConnectedChannelSettings channelId={channelId} />
        </React.Suspense>
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

    dispatch(
      getChannelInfo(channelId, {
        signal: abortController.signal,
        onStart: () => {
          setIsLoading(true)
        },
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
