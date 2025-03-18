import React, { useCallback, useEffect, useState } from 'react'
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
import { SbMessage } from '../messaging/message-records'
import { push } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { usePrevious, useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { bodyLarge, titleLarge } from '../styles/typography'
import { MenuItemCategory } from '../users/user-context-menu'
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
import { CHANNEL_HEADER_HEIGHT, ChannelHeader } from './channel-header'
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

const StyledUserList = styled(ChannelUserList)`
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
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const detailedChannelInfo = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId))
  const joinedChannelInfo = useAppSelector(s => s.chat.idToJoinedInfo.get(channelId))
  const channelUsers = useAppSelector(s => s.chat.idToUsers.get(channelId))
  const channelMessages = useAppSelector(s => s.chat.idToMessages.get(channelId))
  const selfPreferences = useAppSelector(s => s.chat.idToSelfPreferences.get(channelId))
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
