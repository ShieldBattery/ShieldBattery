import React, { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'
import {
  ChatServiceErrorCode,
  ClientChatMessageType,
  SbChannelId,
  ServerChatMessageType,
} from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user'
import { Chat } from '../messaging/chat'
import { SbMessage } from '../messaging/message-records'
import { push } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { usePrevious, useStableCallback } from '../state-hooks'
import { background700, background800, colorError } from '../styles/colors'
import { headline5, subtitle1 } from '../styles/typography'
import { MenuItemCategory } from '../users/user-context-menu'
import {
  activateChannel,
  correctChannelNameForChat,
  deactivateChannel,
  getChannelInfo,
  getMessageHistory,
  retrieveUserList,
  sendMessage,
} from './action-creators'
import { ConnectedChannelInfoCard } from './channel-info-card'
import { addChannelMessageMenuItems, addChannelUserMenuItems } from './channel-menu-items'
import { ChannelUserList } from './channel-user-list'
import {
  BanUserMessage,
  JoinChannelMessage,
  KickUserMessage,
  LeaveChannelMessage,
  NewChannelOwnerMessage,
  SelfJoinChannelMessage,
} from './chat-message-layout'

const MESSAGES_LIMIT = 50

const Container = styled.div`
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  display: flex;
  background-color: ${background700};
`

const StyledChat = styled(Chat)`
  max-width: 960px;
  flex-grow: 1;
  background-color: ${background800};
`

export function renderChannelMessage(msg: SbMessage) {
  switch (msg.type) {
    case ClientChatMessageType.BanUser:
      return <BanUserMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case ClientChatMessageType.KickUser:
      return <KickUserMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case ServerChatMessageType.JoinChannel:
      return <JoinChannelMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case ClientChatMessageType.LeaveChannel:
      return <LeaveChannelMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case ClientChatMessageType.NewChannelOwner:
      return <NewChannelOwnerMessage key={msg.id} time={msg.time} newOwnerId={msg.newOwnerId} />
    case ClientChatMessageType.SelfJoinChannel:
      return <SelfJoinChannelMessage key={msg.id} channelId={msg.channelId} />
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
  const channelInfo = useAppSelector(s => s.chat.idToInfo.get(channelId))
  const channelUsers = useAppSelector(s => s.chat.idToUsers.get(channelId))
  const channelMessages = useAppSelector(s => s.chat.idToMessages.get(channelId))
  const isInChannel = useAppSelector(s => s.chat.joinedChannels.has(channelId))

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
    if (channelInfo && channelNameFromRoute !== channelInfo.name) {
      correctChannelNameForChat(channelInfo.id, channelInfo.name)
    }
  }, [channelInfo, channelNameFromRoute])

  const onLoadMoreMessages = useStableCallback(() =>
    dispatch(getMessageHistory(channelId, MESSAGES_LIMIT)),
  )

  const onSendChatMessage = useStableCallback((msg: string) =>
    dispatch(sendMessage(channelId, msg)),
  )

  const modifyUserMenuItems = useCallback(
    (
      userId: SbUserId,
      items: Map<MenuItemCategory, React.ReactNode[]>,
      onMenuClose: (event?: MouseEvent) => void,
    ) => addChannelUserMenuItems(userId, items, onMenuClose, channelId),
    [channelId],
  )

  const modifyMessageMenuItems = useCallback(
    (messageId: string, items: React.ReactNode[], onMenuClose: (event?: MouseEvent) => void) =>
      addChannelMessageMenuItems(messageId, items, onMenuClose, channelId),
    [channelId],
  )

  return (
    <Container>
      {isInChannel || isLeavingChannel ? (
        <StyledChat
          listProps={{
            messages: channelMessages?.messages ?? [],
            loading: channelMessages?.loadingHistory,
            hasMoreHistory: channelMessages?.hasHistory,
            refreshToken: channelId,
            renderMessage: renderChannelMessage,
            onLoadMoreMessages,
          }}
          inputProps={{
            onSendChatMessage,
            storageKey: `chat.${channelId}`,
          }}
          extraContent={
            <ChannelUserList
              active={channelUsers?.active}
              idle={channelUsers?.idle}
              offline={channelUsers?.offline}
            />
          }
          modifyUserMenuItems={modifyUserMenuItems}
          modifyMessageMenuItems={modifyMessageMenuItems}
        />
      ) : (
        <ChannelInfoPage channelId={channelId} channelName={channelNameFromRoute} />
      )}
    </Container>
  )
}

const ChannelInfoContainer = styled.div`
  width: 100%;
  max-width: 960px;
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
  ${headline5};
  margin-bottom: 8px;
`

const ErrorText = styled.div`
  ${subtitle1};
  color: ${colorError};
`

function ChannelInfoPage({
  channelId,
  channelName,
}: {
  channelId: SbChannelId
  channelName: string
}) {
  const dispatch = useAppDispatch()
  const channelInfo = useAppSelector(s => s.chat.idToInfo.get(channelId))

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
            This channel could not be found. It might not exist, or it may have been re-created by
            someone else.
          </ErrorText>
        )
      } else {
        errorText = <ErrorText>An error occurred: {error.statusText}</ErrorText>
      }
    } else {
      errorText = (
        <ErrorText>
          Error getting channel info {channelName}: {error.message}
        </ErrorText>
      )
    }
    contents = (
      <ErrorContainer>
        <ChannelName>{channelName}</ChannelName>
        {errorText}
      </ErrorContainer>
    )
  } else if (channelInfo) {
    contents = <ConnectedChannelInfoCard channelId={channelId} channelName={channelName} />
  }

  return <ChannelInfoContainer>{contents}</ChannelInfoContainer>
}
