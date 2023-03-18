import React, { useEffect } from 'react'
import styled from 'styled-components'
import { SbChannelId } from '../../common/chat'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { getBatchChannelInfo } from './action-creators'
import { ConnectedChannelInfoCard } from './channel-info-card'

const ChannelName = styled.span`
  &:hover {
    cursor: pointer;
    text-decoration: underline;
  }
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
  const channelInfo = useAppSelector(s => s.chat.idToInfo.get(channelId))

  useEffect(() => {
    dispatch(getBatchChannelInfo(channelId))
  }, [dispatch, channelId])

  const [channelInfoCardOpen, openChannelInfoCard, closeChannelInfoCard] = usePopoverController()
  const [anchor, anchorX, anchorY] = useAnchorPosition('right', 'top')

  const onClick = useStableCallback((e: React.MouseEvent) => {
    openChannelInfoCard(e)
  })
  const onCloseChannelInfoCard = useStableCallback(() => {
    closeChannelInfoCard()
  })

  return (
    <>
      <Popover
        open={channelInfoCardOpen}
        onDismiss={onCloseChannelInfoCard}
        anchorX={(anchorX ?? 0) + 4}
        anchorY={(anchorY ?? 0) + 4}
        originX={'left'}
        originY={'top'}>
        {channelInfo ? (
          <ConnectedChannelInfoCard channelId={channelId} channelName={channelInfo.name} />
        ) : null}
      </Popover>

      {channelInfo ? (
        <ChannelName className={className} ref={anchor} onClick={onClick}>
          #{channelInfo.name}
        </ChannelName>
      ) : (
        // NOTE(2Pac): This mostly means the channel was deleted (or the channel info was loading),
        // so not sure what's the expected thing to show here.
        <span>{`<#${channelId}>`}</span>
      )}
    </>
  )
}
