import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { ChatServiceErrorCode, SbChannelId } from '../../common/chat'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaisedButton } from '../material/button'
import Card from '../material/card'
import { shadow2dp } from '../material/shadows'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorTextFaint } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import { body1, caption, headline6 } from '../styles/typography'
import { getBatchChannelInfo, joinChannel, navigateToChannel } from './action-creators'
import { ChannelBadge } from './channel-badge'
import { ChannelBanner, ChannelBannerPlaceholderImage } from './channel-banner'

const ChannelCardRoot = styled(Card)`
  position: relative;
  width: 352px;
  padding: 0;

  display: flex;
  flex-direction: column;

  contain: content;
`

const ChannelBannerAndBadge = styled.div`
  box-sizing: content-box;
  position: relative;
  padding-bottom: 20px;
`

const ChannelCardBadge = styled.div`
  ${shadow2dp};
  position: absolute;
  left: 12px;
  bottom: 0;
  width: 52px;
  height: 52px;
  padding: 6px;

  background: var(--sb-color-background);
  border-radius: 9999px;
`

const ChannelName = styled.div`
  ${headline6};
  margin-top: 4px;
  padding: 0 16px;
`

const ChannelUserCount = styled.div`
  ${caption};
  padding: 0 16px;
`

const PrivateChannelDescriptionContainer = styled.div`
  ${body1};
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 16px;
`

const PrivateChannelIcon = styled(MaterialIcon).attrs({ icon: 'lock' })`
  margin-bottom: 8px;
  color: ${colorTextFaint};
`

const PrivateChannelDescriptionText = styled.span`
  color: ${colorTextFaint};
  text-align: center;
`

const ChannelDescriptionContainer = styled.div`
  ${body1};
  margin-top: 16px;
  padding: 0 16px;

  display: -webkit-box;
  -webkit-box-orient: vertical;
  line-clamp: 3;
  -webkit-line-clamp: 3;
  overflow: hidden;
  text-overflow: ellipsis;
`

const NoChannelDescriptionText = styled.span`
  color: ${colorTextFaint};
`

const ChannelActions = styled.div`
  padding: 16px 16px 10px 16px;

  display: flex;
  justify-content: space-between;
`

const JoinedIndicator = styled.div`
  ${body1};

  display: flex;
  align-items: center;
  gap: 4px;

  color: ${colorTextFaint};
`

export interface ConnectedChannelInfoCardProps {
  /**
   * The ID of a channel for which we want to display info for. In case the channel with this ID is
   * not found, the card will display an error.
   */
  channelId: SbChannelId
  /**
   * A channel name which is usually received from the URL route and is mostly used for decorative
   * purposes.
   */
  channelName: string
}

export function ConnectedChannelInfoCard({
  channelId,
  channelName,
}: ConnectedChannelInfoCardProps) {
  const dispatch = useAppDispatch()
  const channelInfo = useAppSelector(s => s.chat.idToInfo.get(channelId))
  const isUserInChannel = useAppSelector(s => s.chat.joinedChannels.has(channelId))

  const [isJoinInProgress, setIsJoinInProgress] = useState(false)
  const [isUserBanned, setIsUserBanned] = useState(false)

  useEffect(() => {
    dispatch(getBatchChannelInfo(channelId))
  }, [dispatch, channelId])

  const onViewClick = useStableCallback(() => {
    navigateToChannel(channelId, channelName)
  })

  const onJoinClick = useStableCallback(() => {
    setIsJoinInProgress(true)
    dispatch(
      joinChannel(channelName, {
        onSuccess: () => {},
        onError: err => {
          setIsJoinInProgress(false)

          // NOTE(2Pac): We assume the error has been handled in the action creator, we just need to
          // deal with the ban case in this UI.
          if (isFetchError(err) && err.code === ChatServiceErrorCode.UserBanned) {
            setIsUserBanned(true)
          }
        },
      }),
    )
  })

  let channelDescription
  if (!channelInfo) {
    channelDescription = <LoadingDotsArea />
  } else if (channelInfo.private && !isUserInChannel) {
    channelDescription = (
      <PrivateChannelDescriptionContainer>
        <PrivateChannelIcon size={40} />
        <PrivateChannelDescriptionText>
          This channel is private and requires an invite to join.
        </PrivateChannelDescriptionText>
      </PrivateChannelDescriptionContainer>
    )
  } else if (channelInfo.description) {
    channelDescription = (
      <ChannelDescriptionContainer>
        <span>{channelInfo.description}</span>
      </ChannelDescriptionContainer>
    )
  } else {
    channelDescription = (
      <ChannelDescriptionContainer>
        <NoChannelDescriptionText>This channel has no description.</NoChannelDescriptionText>
      </ChannelDescriptionContainer>
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
    <ChannelCardRoot>
      <ChannelBannerAndBadge>
        {channelInfo?.bannerPath ? (
          <ChannelBanner src={channelInfo.bannerPath} />
        ) : (
          <ChannelBannerPlaceholderImage />
        )}
        {channelInfo ? (
          <ChannelCardBadge>
            <ChannelBadge channelInfo={channelInfo} />
          </ChannelCardBadge>
        ) : null}
      </ChannelBannerAndBadge>
      <ChannelName>{channelInfo?.name ?? channelName}</ChannelName>
      {channelInfo?.userCount ? (
        <ChannelUserCount>
          {`${channelInfo.userCount} member${channelInfo.userCount > 1 ? 's' : ''}`}
        </ChannelUserCount>
      ) : null}
      {channelDescription}
      <FlexSpacer />
      <ChannelActions>
        {isUserInChannel ? (
          <JoinedIndicator>
            <MaterialIcon icon='check' />
            <span>Joined</span>
          </JoinedIndicator>
        ) : (
          <div />
        )}
        {action}
      </ChannelActions>
    </ChannelCardRoot>
  )
}
