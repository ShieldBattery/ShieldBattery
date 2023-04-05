import React, { useEffect } from 'react'
import styled from 'styled-components'
import { SbChannelId } from '../../common/chat'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorDividers } from '../styles/colors'
import { getBatchChannelInfo } from './action-creators'
import { ConnectedChannelInfoCard } from './channel-info-card'

const ChannelName = styled.span`
  &:hover {
    cursor: pointer;
    text-decoration: underline;
  }
`

const LoadingChannelName = styled.span`
  background-color: ${colorDividers};
  border-radius: 2px;
`

export interface ConnectedChannelNameProps {
  className?: string
  /** The channel to show the corresponding name for. */
  channelId: SbChannelId
}

/**
 * A component which, given a channel ID, displays a clickable channel name, which displays channel
 * info when clicked.
 */
export function ConnectedChannelName({ className, channelId }: ConnectedChannelNameProps) {
  const dispatch = useAppDispatch()
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const isChannelDeleted = useAppSelector(s => s.chat.deletedChannels.has(channelId))

  useEffect(() => {
    if (!isChannelDeleted) {
      dispatch(getBatchChannelInfo(channelId))
    }
  }, [dispatch, channelId, isChannelDeleted])

  const [channelInfoCardOpen, openChannelInfoCard, closeChannelInfoCard] = usePopoverController()
  const [anchor, anchorX, anchorY] = useAnchorPosition('right', 'top')

  const onClick = useStableCallback((e: React.MouseEvent) => {
    openChannelInfoCard(e)
  })
  const onCloseChannelInfoCard = useStableCallback(() => {
    closeChannelInfoCard()
  })

  if (isChannelDeleted) {
    return <span>#deleted-channel</span>
  }

  return (
    <>
      <Popover
        open={channelInfoCardOpen}
        onDismiss={onCloseChannelInfoCard}
        anchorX={(anchorX ?? 0) + 4}
        anchorY={(anchorY ?? 0) + 4}
        originX={'left'}
        originY={'top'}>
        {basicChannelInfo ? (
          <ConnectedChannelInfoCard channelId={channelId} channelName={basicChannelInfo.name} />
        ) : null}
      </Popover>

      {basicChannelInfo ? (
        <ChannelName className={className} ref={anchor} onClick={onClick}>
          #{basicChannelInfo.name}
        </ChannelName>
      ) : (
        <LoadingChannelName aria-label={'Channel name loading…'}>
          &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;
        </LoadingChannelName>
      )}
    </>
  )
}
