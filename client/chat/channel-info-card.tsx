import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { ChatServiceErrorCode, SbChannelId } from '../../common/chat'
import { urlPath } from '../../common/urls'
import { hasAnyPermission } from '../admin/admin-permissions'
import { useOverflowingElement } from '../dom/overflowing-element'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton, RaisedButton } from '../material/button'
import Card from '../material/card'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover'
import { shadow2dp } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorTextFaint } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import { body1, caption, headline6, singleLine } from '../styles/typography'
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

const ChannelNameContainer = styled.div`
  position: relative;
`

const ChannelName = styled.div<{ $hasOverflowMenu: boolean }>`
  ${headline6};
  ${singleLine};
  margin-top: 4px;
  margin-right: ${props => (props.$hasOverflowMenu ? '48px' : '0px')};
  padding: 0 16px;
`

const OverflowMenuButton = styled(IconButton)`
  // NOTE(2Pac): We use absolute positioning here instead of flex layout because this icon is too
  // big and it pushes everything down (and making it smaller looks even worse).
  position: absolute;
  top: -4px;
  right: 0;
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

/**
 * A component which finds a channel for a given channel ID and displays its info. Allows users to
 * join the channel if they're not already in it, and handles errors in case the channel is not
 * found etc.
 */
export function ConnectedChannelInfoCard({
  channelId,
  channelName,
}: ConnectedChannelInfoCardProps) {
  const dispatch = useAppDispatch()
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const detailedChannelInfo = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId))
  const isUserInChannel = useAppSelector(s => s.chat.joinedChannels.has(channelId))
  // TODO(2Pac): Add a separate permission for managing chat channels
  const isAdmin = useAppSelector(s => hasAnyPermission(s.auth, 'moderateChatChannels'))

  const [channelNameRef, isChannelNameOverflowing] = useOverflowingElement()
  const [overflowMenuOpen, openOverflowMenu, closeOverflowMenu] = usePopoverController()
  const [anchor, anchorX, anchorY] = useAnchorPosition('left', 'top')

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

  const onAdminViewClick = useStableCallback(() => {
    push(urlPath`/chat/admin/channel-view/${channelId}/${channelName}`)
  })

  let channelDescription
  if (!basicChannelInfo) {
    channelDescription = <LoadingDotsArea />
  } else if (basicChannelInfo.private && !isUserInChannel) {
    channelDescription = (
      <PrivateChannelDescriptionContainer>
        <PrivateChannelIcon size={40} />
        <PrivateChannelDescriptionText>
          This channel is private and requires an invite to join.
        </PrivateChannelDescriptionText>
      </PrivateChannelDescriptionContainer>
    )
  } else if (detailedChannelInfo?.description) {
    channelDescription = (
      <ChannelDescriptionContainer>
        <span>{detailedChannelInfo.description}</span>
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
  } else if (basicChannelInfo?.private || isUserBanned) {
    action = <RaisedButton label='Join' disabled={true} />
  } else if (basicChannelInfo) {
    action = <RaisedButton label='Join' disabled={isJoinInProgress} onClick={onJoinClick} />
  }

  return (
    <>
      {isAdmin ? (
        <Popover
          open={overflowMenuOpen}
          onDismiss={closeOverflowMenu}
          anchorX={anchorX ?? 0}
          anchorY={anchorY ?? 0}
          originX={'left'}
          originY={'top'}>
          <MenuList>
            <MenuItem text='Admin view' onClick={onAdminViewClick} />
          </MenuList>
        </Popover>
      ) : null}

      <ChannelCardRoot>
        <ChannelBannerAndBadge>
          {detailedChannelInfo?.bannerPath ? (
            <ChannelBanner src={detailedChannelInfo.bannerPath} />
          ) : (
            <ChannelBannerPlaceholderImage />
          )}
          {basicChannelInfo ? (
            <ChannelCardBadge>
              <ChannelBadge
                basicChannelInfo={basicChannelInfo}
                detailedChannelInfo={detailedChannelInfo}
              />
            </ChannelCardBadge>
          ) : null}
        </ChannelBannerAndBadge>
        <ChannelNameContainer>
          <Tooltip
            text={basicChannelInfo?.name ?? channelName}
            position='bottom'
            disabled={!isChannelNameOverflowing}>
            <ChannelName ref={channelNameRef} $hasOverflowMenu={isAdmin}>
              {basicChannelInfo?.name ?? channelName}
            </ChannelName>
          </Tooltip>
          {isAdmin ? (
            <OverflowMenuButton
              ref={anchor}
              icon={<MaterialIcon icon='more_vert' />}
              title='More actions'
              onClick={openOverflowMenu}
            />
          ) : null}
        </ChannelNameContainer>
        {detailedChannelInfo?.userCount ? (
          <ChannelUserCount>
            {`${detailedChannelInfo.userCount} member${
              detailedChannelInfo.userCount > 1 ? 's' : ''
            }`}
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
    </>
  )
}
