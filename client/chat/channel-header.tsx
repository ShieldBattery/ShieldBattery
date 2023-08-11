import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import {
  BasicChannelInfo,
  DetailedChannelInfo,
  JoinedChannelInfo,
  SbChannelId,
} from '../../common/chat'
import { CAN_LEAVE_SHIELDBATTERY_CHANNEL } from '../../common/flags'
import { matchLinks } from '../../common/text/links'
import { useOverflowingElement } from '../dom/overflowing-element'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { DestructiveMenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover'
import { shadow2dp } from '../material/shadows'
import { Tooltip, TooltipContent } from '../material/tooltip'
import { ExternalLink } from '../navigation/external-link'
import { LoadingDotsArea } from '../progress/dots'
import { useStableCallback } from '../state-hooks'
import { background700, colorTextFaint, colorTextSecondary } from '../styles/colors'
import { caption, headline6, singleLine } from '../styles/typography'
import { ChannelBadge } from './channel-badge'

const ChannelHeaderRoot = styled.div<{ $hasRightPadding: boolean }>`
  ${shadow2dp};
  width: 100%;
  height: 72px;
  padding: 8px;
  padding-right: ${props => (props.$hasRightPadding ? '8px' : '0')};
  background-color: ${background700};

  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
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
  ${headline6};
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
  ${caption};
  ${singleLine};
  color: ${colorTextFaint};

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
`

const UserCountIcon = styled(MaterialIcon).attrs({ icon: 'groups' })`
  color: ${colorTextSecondary};
`

const UserCountText = styled.div`
  ${caption};
  color: ${colorTextSecondary};
`

const StyledIconButton = styled(IconButton)`
  color: ${colorTextSecondary};
`

export interface ChannelHeaderProps {
  basicChannelInfo: ReadonlyDeep<BasicChannelInfo>
  detailedChannelInfo: ReadonlyDeep<DetailedChannelInfo>
  joinedChannelInfo: ReadonlyDeep<JoinedChannelInfo>
  onLeaveChannel: (channelId: SbChannelId) => void
}

export function ChannelHeader({
  basicChannelInfo,
  detailedChannelInfo,
  joinedChannelInfo,
  onLeaveChannel,
}: ChannelHeaderProps) {
  const { t } = useTranslation()

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

  const onLeaveChannelClick = useStableCallback(() => {
    onLeaveChannel(basicChannelInfo.id)
  })

  const actions: React.ReactNode[] = []
  if (basicChannelInfo.id !== 1 || CAN_LEAVE_SHIELDBATTERY_CHANNEL) {
    actions.push(
      <DestructiveMenuItem
        key='leave-channel'
        text={t('chat.channelHeader.actionItems.leaveChannel', 'Leave channel')}
        onClick={onLeaveChannelClick}
      />,
    )
  }

  return (
    <ChannelHeaderRoot $hasRightPadding={actions.length === 0}>
      {!basicChannelInfo ? (
        <LoadingDotsArea />
      ) : (
        <>
          {actions.length > 0 ? (
            <Popover
              open={overflowMenuOpen}
              onDismiss={closeOverflowMenu}
              anchorX={anchorX ?? 0}
              anchorY={anchorY ?? 0}
              originX={'right'}
              originY={'top'}>
              <MenuList dense={true}>{actions}</MenuList>
            </Popover>
          ) : null}

          <BadgeAndTextContainer>
            <StyledChannelBadge
              basicChannelInfo={basicChannelInfo}
              detailedChannelInfo={detailedChannelInfo}
            />
            <NameAndTopicContainer>
              <ChannelName>{basicChannelInfo.name}</ChannelName>
              {parsedChannelTopic ? (
                <StyledTooltip
                  text={parsedChannelTopic}
                  position='bottom'
                  disabled={!isChannelTopicOverflowing}
                  ContentComponent={StyledTooltipContent}>
                  <ChannelTopic ref={channelTopicRef}>{parsedChannelTopic}</ChannelTopic>
                </StyledTooltip>
              ) : null}
            </NameAndTopicContainer>
          </BadgeAndTextContainer>

          <ActionsArea>
            <UserCountContainer>
              <UserCountIcon icon='groups' size={20} />
              <UserCountText>{detailedChannelInfo.userCount}</UserCountText>
            </UserCountContainer>
            {actions.length > 0 ? (
              <StyledIconButton
                ref={anchor}
                icon={<MaterialIcon icon='more_vert' />}
                title={t('chat.channelHeader.moreActions', 'More actions')}
                onClick={openOverflowMenu}
              />
            ) : null}
          </ActionsArea>
        </>
      )}
    </ChannelHeaderRoot>
  )
}
