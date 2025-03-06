import React from 'react'
import styled, { css } from 'styled-components'
import { CHANNEL_BANNER_HEIGHT, CHANNEL_BANNER_WIDTH } from '../../common/chat'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { MaterialIcon } from '../icons/material/material-icon'

const channelBannerCommon = css`
  width: 100%;
  height: auto;
  aspect-ratio: ${CHANNEL_BANNER_WIDTH} / ${CHANNEL_BANNER_HEIGHT};
  background-color: var(--color-grey-blue30);
  border-radius: 2px;
  contain: content;
`

export const ChannelBannerContainer = styled.div`
  ${channelBannerCommon};
  overflow: hidden;

  & > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

export function ChannelBanner({ src, testName }: { src: string; testName?: string }) {
  return (
    <ChannelBannerContainer>
      <img src={src} alt='' draggable={false} data-test={testName} />
    </ChannelBannerContainer>
  )
}

const ChannelBannerPlaceholderContainer = styled.div`
  ${channelBannerCommon};
  color: rgb(from var(--theme-on-surface-variant) r g b / 0.7);

  display: flex;
  align-items: center;
  justify-content: center;
`

export function ChannelBannerPlaceholderImage() {
  const [bannerRef, bannerRect] = useObservedDimensions()

  return (
    <ChannelBannerPlaceholderContainer ref={bannerRef}>
      {bannerRect ? (
        <MaterialIcon icon='chat' size={Math.round(bannerRect.width * 0.22727272)} />
      ) : undefined}
    </ChannelBannerPlaceholderContainer>
  )
}
