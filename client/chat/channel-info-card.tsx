import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { ChatServiceErrorCode, SbChannelId } from '../../common/chat'
import ChannelIcon from '../icons/material/image-24px.svg'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaisedButton } from '../material/button'
import Card from '../material/card'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorError } from '../styles/colors'
import { body1, Body1, Headline6 } from '../styles/typography'
import { getChannelInfo, joinChannel, navigateToChannel } from './action-creators'

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
`

const StyledChannelIcon = styled.svg`
  width: 56px;
  height: auto;
  flex-shrink: 0;
`

const ErrorChannelIcon = styled(MaterialIcon)`
  flex-shrink: 0;
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

export interface ConnectedChannelInfoCardProps {
  channelId: SbChannelId
  channelName: string
}

export function ConnectedChannelInfoCard({
  channelId,
  channelName,
}: ConnectedChannelInfoCardProps) {
  const dispatch = useAppDispatch()
  const channelInfo = useAppSelector(s => s.chat.idToInfo.get(channelId))
  const isUserInChannel = useAppSelector(s => s.chat.joinedChannels.has(channelId))

  const [findChannelError, setFindChannelError] = useState<Error>()
  const [joinChannelError, setJoinChannelError] = useState<Error>()
  const [isJoinInProgress, setIsJoinInProgress] = useState(false)

  useEffect(() => {
    const abortController = new AbortController()

    dispatch(
      getChannelInfo(channelId, {
        signal: abortController.signal,
        onSuccess: () => setFindChannelError(undefined),
        onError: err => setFindChannelError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [channelId, dispatch])

  const onViewClick = useStableCallback(() => {
    navigateToChannel(channelId, channelName)
  })

  const onJoinClick = useStableCallback(() => {
    setIsJoinInProgress(true)
    dispatch(
      joinChannel(channelName, {
        onSuccess: channel => navigateToChannel(channel.id, channel.name),
        onError: err => {
          setJoinChannelError(err)
          setIsJoinInProgress(false)
        },
      }),
    )
  })

  const isChannelNotFound =
    isFetchError(findChannelError) && findChannelError.code === ChatServiceErrorCode.ChannelNotFound
  const isUserBanned =
    isFetchError(joinChannelError) && joinChannelError.code === ChatServiceErrorCode.UserBanned

  const icon =
    channelInfo && (!channelInfo.private || isUserInChannel) ? (
      <StyledChannelIcon as={ChannelIcon} />
    ) : (
      <ErrorChannelIcon icon='warning' size={56} />
    )

  let subtitle
  if (isChannelNotFound) {
    subtitle = (
      <ErrorText>
        This channel could not be found. It might not exist, or it may have been re-created by
        someone else.
      </ErrorText>
    )
  } else if (channelInfo?.private && !isUserInChannel) {
    subtitle = <ErrorText>This channel is private and requires an invite to join.</ErrorText>
  } else if (isUserBanned) {
    subtitle = <ErrorText>You are banned from this channel.</ErrorText>
  } else if (channelInfo?.userCount) {
    subtitle = (
      <Body1>{`${channelInfo.userCount} member${channelInfo.userCount > 1 ? 's' : ''}`}</Body1>
    )
  }

  let action
  if (isUserInChannel) {
    action = <RaisedButton label='View' onClick={onViewClick} />
  } else if (channelInfo?.private || isUserBanned) {
    action = <RaisedButton label='Join' disabled={true} />
  } else if (channelInfo) {
    action = <RaisedButton label='Join' disabled={isJoinInProgress} onClick={onJoinClick} />
  }

  return (
    <Container>
      {!channelInfo && !findChannelError ? (
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
