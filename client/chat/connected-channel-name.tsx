import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { SbChannelId } from '../../common/chat'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { getBatchChannelInfo } from './action-creators'
import { ConnectedChannelInfoCard } from './channel-info-card'

const ChannelName = styled.span<{ $interactive?: boolean }>`
  ${props =>
    props.$interactive
      ? css`
          &:hover {
            cursor: pointer;
            text-decoration: underline;
          }

          &:focus-visible {
            outline: none;
            text-decoration: underline;
          }
        `
      : css``}
`

const LoadingChannelName = styled.span`
  background-color: rgb(from var(--theme-on-surface-variant) r g b / 0.5);
  border-radius: 4px;
`

export interface ConnectedChannelNameProps {
  className?: string
  /** The channel to show the corresponding name for. */
  channelId: SbChannelId
  /** Whether the channel name can be interacted with (clicked, focused, etc.). Defaults to true. */
  interactive?: boolean
}

/**
 * A component which, given a channel ID, displays a clickable channel name, which displays channel
 * info when clicked.
 */
export function ConnectedChannelName({
  className,
  channelId,
  interactive = true,
}: ConnectedChannelNameProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const isChannelDeleted = useAppSelector(s => s.chat.deletedChannels.has(channelId))

  useEffect(() => {
    if (!isChannelDeleted) {
      dispatch(getBatchChannelInfo(channelId))
    }
  }, [dispatch, channelId, isChannelDeleted])

  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [channelInfoCardOpen, openChannelInfoCard, closeChannelInfoCard] = usePopoverController({
    refreshAnchorPos,
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openChannelInfoCard()
    }
  }

  if (isChannelDeleted) {
    return <span>#{t('chat.channelName.deletedChannel', 'deleted-channel')}</span>
  }

  return (
    <>
      {interactive ? (
        <Popover
          open={channelInfoCardOpen}
          onDismiss={closeChannelInfoCard}
          anchorX={(anchorX ?? 0) + 4}
          anchorY={(anchorY ?? 0) + 4}
          originX={'left'}
          originY={'top'}>
          {basicChannelInfo ? (
            <ConnectedChannelInfoCard channelId={channelId} channelName={basicChannelInfo.name} />
          ) : null}
        </Popover>
      ) : undefined}

      {basicChannelInfo ? (
        <ChannelName
          className={className}
          ref={anchor}
          onClick={interactive ? openChannelInfoCard : undefined}
          onKeyDown={interactive ? onKeyDown : undefined}
          tabIndex={interactive ? 0 : undefined}
          $interactive={interactive}>
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
