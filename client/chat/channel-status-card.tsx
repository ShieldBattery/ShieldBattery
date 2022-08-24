import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { ChannelStatus, ChatServiceErrorCode, SbChannelId } from '../../common/chat'
import ChannelIcon from '../icons/material/baseline-image-24px.svg'
import WarningIcon from '../icons/material/warning_black_36px.svg'
import { RaisedButton } from '../material/button'
import Card from '../material/card'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorError } from '../styles/colors'
import { body1, Body1, Headline6 } from '../styles/typography'
import { findChannel, joinChannel, navigateToChannel } from './action-creators'

const Container = styled(Card)`
  width: 100%;
  max-width: 440px;
  min-width: 220px;
  padding: 16px;

  display: flex;
  flex-direction: row;
  align-items: center;
`

const StyledLoadingDotsArea = styled(LoadingDotsArea)`
  width: 100%;
  height: 100%;
  max-width: 960px;
`

const StyledChannelIcon = styled.svg`
  width: 56px;
  height: auto;
  flex-shrink: 0;
`

const ErrorChannelIcon = styled(StyledChannelIcon)`
  color: ${colorError};
`

const ChannelInfoContainer = styled.div`
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  margin: 0 8px;
`

const ErrorText = styled.div`
  ${body1};
  color: ${colorError};
`

export interface ChannelStatusCardProps {
  channelName: string
  channelStatus?: ChannelStatus
  isUserInChannel: boolean
  findChannelError?: Error
  joinChannelError?: Error
  onViewClick: () => void
  onJoinClick: () => void
}

// NOTE(2Pac): This component was extracted mainly for easier testing in dev pages and probably
// shouldn't be used on its own.
export function ChannelStatusCard({
  channelName,
  channelStatus,
  isUserInChannel,
  findChannelError,
  joinChannelError,
  onViewClick,
  onJoinClick,
}: ChannelStatusCardProps) {
  const icon =
    channelStatus && (!channelStatus.private || isUserInChannel) ? (
      <StyledChannelIcon as={ChannelIcon} />
    ) : (
      <ErrorChannelIcon as={WarningIcon} />
    )

  const isChannelNotFound =
    isFetchError(findChannelError) && findChannelError.code === ChatServiceErrorCode.ChannelNotFound
  const isChannelClosed =
    isFetchError(findChannelError) && findChannelError.code === ChatServiceErrorCode.ChannelClosed
  const isUserBanned =
    isFetchError(joinChannelError) && joinChannelError.code === ChatServiceErrorCode.UserBanned

  let subtitle
  if (isChannelNotFound) {
    subtitle = <ErrorText>We couldn't find this channel, you may create it yourself</ErrorText>
  } else if (isChannelClosed) {
    subtitle = <ErrorText>We couldn't find this channel, it might have been closed</ErrorText>
  } else if (channelStatus?.private && !isUserInChannel) {
    subtitle = <ErrorText>This channel is private and requires an invite to join</ErrorText>
  } else if (isUserBanned) {
    subtitle = <ErrorText>You are banned from this channel</ErrorText>
  } else if (channelStatus?.userCount) {
    subtitle = (
      <Body1>{`${channelStatus.userCount} member${channelStatus.userCount > 1 ? 's' : ''}`}</Body1>
    )
  }

  let action
  if (isUserInChannel) {
    action = <RaisedButton label='View' onClick={onViewClick} />
  } else if (isChannelNotFound) {
    action = <RaisedButton label='Create' onClick={onJoinClick} />
  } else if (channelStatus?.private || isUserBanned) {
    action = <RaisedButton label='Join' disabled={true} />
  } else if (!findChannelError) {
    action = <RaisedButton label='Join' onClick={onJoinClick} />
  }

  return (
    <Container>
      {!channelStatus && !findChannelError ? (
        <StyledLoadingDotsArea />
      ) : (
        <>
          {icon}
          <ChannelInfoContainer>
            <Headline6>{channelName}</Headline6>
            {subtitle}
          </ChannelInfoContainer>
          {action}
        </>
      )}
    </Container>
  )
}

export interface ConnectedChannelStatusCardProps {
  channelId: SbChannelId
  channelName: string
}

export function ConnectedChannelStatusCard({
  channelId,
  channelName,
}: ConnectedChannelStatusCardProps) {
  const dispatch = useAppDispatch()
  const channel = useAppSelector(s => s.chat.byId.get(channelId))
  const channelStatus = useAppSelector(s => s.channelStatus.byId.get(channelId))

  const [findChannelError, setFindChannelError] = useState<Error>()
  const [joinChannelError, setJoinChannelError] = useState<Error>()
  const cancelJoinRef = useRef(new AbortController())

  useEffect(() => {
    const abortController = new AbortController()

    dispatch(
      findChannel(channelId, channelName, {
        signal: abortController.signal,
        onSuccess: () => setFindChannelError(undefined),
        onError: err => setFindChannelError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [channelId, dispatch, channelName])

  useEffect(() => {
    const abortController = cancelJoinRef.current

    return () => {
      abortController.abort()
    }
  }, [])

  const onViewClick = useStableCallback(() => {
    navigateToChannel(channelId, channelName)
  })

  const onJoinClick = useStableCallback(() => {
    dispatch(
      joinChannel(channelName, {
        signal: cancelJoinRef.current.signal,
        onSuccess: channel => navigateToChannel(channel.id, channel.name),
        onError: err => setJoinChannelError(err),
      }),
    )
  })

  return (
    <ChannelStatusCard
      channelName={channelName}
      channelStatus={channelStatus}
      isUserInChannel={!!channel}
      findChannelError={findChannelError}
      joinChannelError={joinChannelError}
      onViewClick={onViewClick}
      onJoinClick={onJoinClick}
    />
  )
}
