import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ChatServiceErrorCode, SbChannelId } from '../../common/chat'
import { urlPath } from '../../common/urls'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, IconButton } from '../material/button'
import { Card } from '../material/card'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { elevationPlus1 } from '../material/shadows'
import { push } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { FlexSpacer } from '../styles/flex-spacer'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { bodyMedium, labelMedium, titleLarge } from '../styles/typography'
import {
  getBatchChannelInfo,
  joinChannelWithErrorHandling,
  navigateToChannel,
} from './action-creators'
import { ChannelBadge } from './channel-badge'
import { ChannelBanner, ChannelBannerPlaceholderImage } from './channel-banner'

export const ChannelCardRoot = styled(Card)`
  position: relative;
  width: 352px;
  padding: 0;

  display: flex;
  flex-direction: column;

  contain: content;
`

const OverflowMenuButton = styled(IconButton)`
  position: absolute;
  top: 4px;
  right: 4px;
`

export const ChannelBannerAndBadge = styled.div`
  box-sizing: content-box;
  position: relative;
  padding-bottom: 20px;
`

export const ChannelCardBadge = styled.div`
  ${elevationPlus1};
  position: absolute;
  left: 12px;
  bottom: 0;
  width: 52px;
  height: 52px;
  padding: 6px;

  background: var(--sb-color-background);
  border-radius: 16px;
`

export const ChannelName = styled.div`
  ${titleLarge};
  margin-top: 4px;
  padding: 0 16px;
`

const ChannelUserCount = styled.div`
  ${labelMedium};
  padding: 0 16px;
`

const PrivateChannelDescriptionContainer = styled.div`
  ${bodyMedium};
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 16px;
`

const PrivateChannelIcon = styledWithAttrs(MaterialIcon, { icon: 'lock' })`
  margin-bottom: 8px;
  color: var(--theme-on-surface-variant);
`

const PrivateChannelDescriptionText = styled.span`
  color: var(--theme-on-surface-variant);
  text-align: center;
`

export const ChannelDescriptionContainer = styled.div`
  ${bodyMedium};
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
  color: var(--theme-on-surface-variant);
`

export const ChannelActions = styled.div`
  padding: 16px 16px 10px 16px;

  display: flex;
  justify-content: space-between;
`

const JoinedIndicator = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-on-surface-variant);
`

export interface ConnectedChannelInfoCardProps {
  /**
   * The ID of a channel for which we want to display info for.
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
 * join the channel if they're not already in it.
 *
 * NOTE: This component assumes the channel exists and doesn't handle errors in case the channel was
 * not found.
 */
export function ConnectedChannelInfoCard({
  channelId,
  channelName,
}: ConnectedChannelInfoCardProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const detailedChannelInfo = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId))
  const isUserInChannel = useAppSelector(s => s.chat.joinedChannels.has(channelId))
  const isAdmin = useHasAnyPermission('moderateChatChannels')

  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'top')
  const [overflowMenuOpen, openOverflowMenu, closeOverflowMenu] = usePopoverController({
    refreshAnchorPos,
  })

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
      joinChannelWithErrorHandling(channelName, {
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
    push(urlPath`/chat/admin/${channelId}/${channelName}/view`)
  })

  let channelDescription
  if (!basicChannelInfo) {
    channelDescription = <LoadingDotsArea />
  } else if (basicChannelInfo.private && !isUserInChannel) {
    channelDescription = (
      <PrivateChannelDescriptionContainer>
        <PrivateChannelIcon size={40} />
        <PrivateChannelDescriptionText>
          {t(
            'chat.channelInfoCard.private',
            'This channel is private and requires an invite to join.',
          )}
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
        <NoChannelDescriptionText>
          {t('chat.channelInfoCard.noDescription', 'This channel has no description.')}
        </NoChannelDescriptionText>
      </ChannelDescriptionContainer>
    )
  }

  let action
  if (isUserInChannel) {
    action = <FilledButton label={t('common.actions.view', 'View')} onClick={onViewClick} />
  } else if (basicChannelInfo?.private || isUserBanned) {
    action = <FilledButton label={t('common.actions.join', 'Join')} disabled={true} />
  } else if (basicChannelInfo) {
    action = (
      <FilledButton
        label={t('common.actions.join', 'Join')}
        disabled={isJoinInProgress}
        onClick={onJoinClick}
      />
    )
  }

  return (
    <ChannelCardRoot>
      {isAdmin ? (
        <Popover
          open={overflowMenuOpen}
          onDismiss={closeOverflowMenu}
          anchorX={anchorX ?? 0}
          anchorY={anchorY ?? 0}
          originX={'left'}
          originY={'top'}>
          <MenuList>
            <MenuItem
              text={t('chat.channelInfoCard.adminView', 'Admin view')}
              onClick={onAdminViewClick}
            />
          </MenuList>
        </Popover>
      ) : null}

      <ChannelBannerAndBadge>
        {detailedChannelInfo?.bannerPath ? (
          <ChannelBanner src={detailedChannelInfo.bannerPath} />
        ) : (
          <ChannelBannerPlaceholderImage />
        )}
        {basicChannelInfo ? (
          <ChannelCardBadge>
            <ChannelBadge
              src={detailedChannelInfo?.badgePath}
              channelName={basicChannelInfo.name}
            />
          </ChannelCardBadge>
        ) : null}
      </ChannelBannerAndBadge>
      <ChannelName>{basicChannelInfo?.name ?? channelName}</ChannelName>

      {detailedChannelInfo?.userCount ? (
        <ChannelUserCount>
          <Trans
            t={t}
            i18nKey='chat.channelInfoCard.userCount'
            count={detailedChannelInfo.userCount}>
            {{ count: detailedChannelInfo.userCount }} member
          </Trans>
        </ChannelUserCount>
      ) : null}
      {channelDescription}
      <FlexSpacer />
      <ChannelActions>
        {isUserInChannel ? (
          <JoinedIndicator>
            <MaterialIcon icon='check' />
            <span>{t('chat.channelInfoCard.joined', 'Joined')}</span>
          </JoinedIndicator>
        ) : (
          <div />
        )}
        {action}
      </ChannelActions>

      {isAdmin ? (
        <OverflowMenuButton
          ref={anchor}
          icon={<MaterialIcon icon='more_vert' />}
          title={t('chat.channelInfoCard.moreActions', 'More actions')}
          onClick={openOverflowMenu}
        />
      ) : null}
    </ChannelCardRoot>
  )
}
