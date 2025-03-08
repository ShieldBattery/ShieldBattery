import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import {
  BasicChannelInfo,
  ChannelPreferences,
  DetailedChannelInfo,
  JoinedChannelInfo,
  SbChannelId,
} from '../../common/chat'
import { CAN_LEAVE_SHIELDBATTERY_CHANNEL } from '../../common/flags'
import { matchLinks } from '../../common/text/links'
import { useSelfPermissions, useSelfUser } from '../auth/auth-utils'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useOverflowingElement } from '../dom/overflowing-element'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { CheckableMenuItem } from '../material/menu/checkable-item'
import { Divider } from '../material/menu/divider'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover'
import { Tooltip, TooltipContent } from '../material/tooltip'
import { ExternalLink } from '../navigation/external-link'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { useStableCallback } from '../state-hooks'
import { BodySmall, labelMedium, singleLine, titleLarge } from '../styles/typography'
import { updateChannelUserPreferences } from './action-creators'
import { ChannelBadge } from './channel-badge'

export const CHANNEL_HEADER_HEIGHT = 72

const ChannelHeaderRoot = styled.div<{ $hasActions: boolean }>`
  width: 100%;
  height: ${CHANNEL_HEADER_HEIGHT}px;
  padding: 8px;
  padding-right: ${props => (props.$hasActions ? '8px' : '0')};

  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;

  background-color: var(--theme-container-low);
  border-radius: 8px;
`

const StyledMenuList = styled(MenuList)`
  --sb-menu-min-width: 192px;
`

const BadgeAndTextContainer = styled.div`
  // NOTE(2Pac): Need this to make truncated text on channel topic work.
  min-width: 0px;

  flex-grow: 1;
  display: flex;
  align-items: center;
  gap: 16px;
`

const StyledChannelBadge = styled(ChannelBadge)`
  flex-shrink: 0;
`

const NameAndTopicContainer = styled.div`
  // NOTE(2Pac): Need this to make truncated text on channel topic work.
  min-width: 0px;

  display: flex;
  align-items: baseline;
  gap: 16px;
`

const ChannelName = styled.div`
  ${titleLarge};
  flex-shrink: 0;
`

const StyledTooltip = styled(Tooltip)`
  // NOTE(2Pac): Need this to make truncated text on channel topic work.
  min-width: 0px;
`

const StyledTooltipContent = styled(TooltipContent)`
  max-width: 480px;
  display: block;
`

const ChannelTopic = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);

  // NOTE(2Pac): This increases the topic hit area a bit so it's easier to trigger the tooltip, but
  // keeps the text at the same vertical position.
  line-height: 28px;
  margin-top: 6px;
`

const ActionsArea = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const UserCountContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-on-surface-variant);
`

const StyledIconButton = styled(IconButton)`
  color: var(--theme-on-surface-variant);
`

export interface ChannelHeaderProps {
  basicChannelInfo: ReadonlyDeep<BasicChannelInfo>
  detailedChannelInfo: ReadonlyDeep<DetailedChannelInfo>
  joinedChannelInfo: ReadonlyDeep<JoinedChannelInfo>
  selfPreferences: ChannelPreferences
  onLeaveChannel: (channelId: SbChannelId) => void
}

export function ChannelHeader({
  basicChannelInfo,
  detailedChannelInfo,
  joinedChannelInfo,
  selfPreferences,
  onLeaveChannel,
}: ChannelHeaderProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const user = useSelfUser()
  const selfPermissions = useSelfPermissions()

  const [overflowMenuOpen, openOverflowMenu, closeOverflowMenu] = usePopoverController()
  const [anchor, anchorX, anchorY] = useAnchorPosition('right', 'bottom')

  const [channelTopicRef, isChannelTopicOverflowing] = useOverflowingElement()

  // TODO(2Pac): Figure out if we can share this with common-message-layout somehow.
  const parsedChannelTopic = useMemo(() => {
    if (!joinedChannelInfo.topic) {
      return undefined
    }

    const matches = matchLinks(joinedChannelInfo.topic)
    const sortedMatches = Array.from(matches).sort((a, b) => a.index - b.index)
    const elements = []
    let lastIndex = 0

    for (const match of sortedMatches) {
      // This probably can't happen at this moment, but to ensure we don't get tripped by it in the
      // future, if this happens we skip the match entirely as it means it overlaps with a previous
      // match.
      if (match.index < lastIndex) {
        continue
      }

      // Insert preceding text, if any
      if (match.index > lastIndex) {
        elements.push(joinedChannelInfo.topic.substring(lastIndex, match.index))
      }

      if (match.type === 'link') {
        elements.push(
          <ExternalLink key={match.index} href={match.text}>
            {match.text}
          </ExternalLink>,
        )
      } else {
        assertUnreachable(match.type)
      }

      lastIndex = match.index + match.text.length
    }

    // Insert remaining text, if any
    if (joinedChannelInfo.topic.length > lastIndex) {
      elements.push(joinedChannelInfo.topic.substring(lastIndex))
    }

    return elements
  }, [joinedChannelInfo.topic])

  const onChannelSettingsClick = useStableCallback(() => {
    closeOverflowMenu()
    dispatch(
      openDialog({
        type: DialogType.ChannelSettings,
        initData: {
          channelId: basicChannelInfo.id,
        },
      }),
    )
  })
  const onHideBannerClick = useStableCallback(() => {
    dispatch(
      updateChannelUserPreferences(
        basicChannelInfo.id,
        { hideBanner: !selfPreferences.hideBanner },
        {
          onSuccess: () => {},
          onError: err => {
            snackbarController.showSnackbar(
              t(
                'chat.channelHeader.errors.toggleBannerVisibility',
                'Something went wrong toggling the banner visibility',
              ),
            )
          },
        },
      ),
    )
  })
  const onLeaveChannelClick = useStableCallback(() => {
    onLeaveChannel(basicChannelInfo.id)
  })

  const actions: React.ReactNode[] = []
  if (selfPermissions?.moderateChatChannels || user?.id === joinedChannelInfo.ownerId) {
    actions.push(
      <MenuItem
        key='channel-settings'
        text={t('chat.channelHeader.actionItems.channelSettings', 'Channel settings')}
        testName='channel-settings-button'
        onClick={onChannelSettingsClick}
      />,
    )
  }
  if (detailedChannelInfo.bannerPath) {
    actions.push(
      <CheckableMenuItem
        key='hide-banner'
        checked={selfPreferences.hideBanner}
        text={t('chat.channelHeader.actionItems.hideBanner', 'Hide banner')}
        onClick={onHideBannerClick}
      />,
    )
  }
  if (basicChannelInfo.id !== 1 || CAN_LEAVE_SHIELDBATTERY_CHANNEL) {
    actions.push(<Divider key='divider' />)
    actions.push(
      <DestructiveMenuItem
        key='leave-channel'
        text={t('chat.channelHeader.actionItems.leaveChannel', 'Leave channel')}
        onClick={onLeaveChannelClick}
      />,
    )
  }

  return (
    <ChannelHeaderRoot $hasActions={actions.length === 0}>
      {actions.length > 0 ? (
        <Popover
          open={overflowMenuOpen}
          onDismiss={closeOverflowMenu}
          anchorX={anchorX ?? 0}
          anchorY={anchorY ?? 0}
          originX={'right'}
          originY={'top'}>
          <StyledMenuList dense={true}>{actions}</StyledMenuList>
        </Popover>
      ) : null}

      <BadgeAndTextContainer>
        <StyledChannelBadge
          src={detailedChannelInfo.badgePath}
          channelName={basicChannelInfo.name}
        />
        <NameAndTopicContainer>
          <ChannelName>#{basicChannelInfo.name}</ChannelName>
          {parsedChannelTopic ? (
            <StyledTooltip
              text={parsedChannelTopic}
              position='bottom'
              disabled={!isChannelTopicOverflowing}
              interactive={true}
              ContentComponent={StyledTooltipContent}>
              <ChannelTopic ref={channelTopicRef}>{parsedChannelTopic}</ChannelTopic>
            </StyledTooltip>
          ) : null}
        </NameAndTopicContainer>
      </BadgeAndTextContainer>

      <ActionsArea>
        <UserCountContainer>
          <MaterialIcon icon='groups' size={20} />
          <BodySmall>{detailedChannelInfo.userCount}</BodySmall>
        </UserCountContainer>
        {actions.length > 0 ? (
          <StyledIconButton
            ref={anchor}
            icon={<MaterialIcon icon='more_vert' />}
            title={t('chat.channelHeader.moreActions', 'More actions')}
            testName='channel-header-actions-button'
            onClick={openOverflowMenu}
          />
        ) : null}
      </ActionsArea>
    </ChannelHeaderRoot>
  )
}
