import React from 'react'
import styled, { css } from 'styled-components'
import { CHANNEL_BANNER_HEIGHT, CHANNEL_BANNER_WIDTH } from '../../common/chat'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { MaterialIcon } from '../icons/material/material-icon'
import { background600, colorTextFaint } from '../styles/colors'

const channelBannerCommon = css`
  width: 100%;
  height: auto;
  aspect-ratio: ${CHANNEL_BANNER_WIDTH} / ${CHANNEL_BANNER_HEIGHT};
  background-color: ${background600};
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

export function ChannelBanner({ src }: { src: string }) {
  return (
    <ChannelBannerContainer>
      <img src={src} alt='' draggable={false} />
    </ChannelBannerContainer>
  )
}

const ChannelBannerPlaceholderContainer = styled.div`
  ${channelBannerCommon};
  color: ${colorTextFaint};

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
