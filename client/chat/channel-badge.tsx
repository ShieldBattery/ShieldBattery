import { meetsContrastGuidelines } from 'polished'
import React from 'react'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { ChannelInfo } from '../../common/chat'
import { randomColorForString } from '../avatars/colors'
import { blue400, colorTextInvert, colorTextPrimary } from '../styles/colors'
import { headline3 } from '../styles/typography'

const badgeCommon = css`
  width: 40px;
  height: 40px;
  border-radius: 9999px;
  contain: content;
`

const ChannelBadgePlaceholder = styled.svg`
  ${badgeCommon};
  background-color: var(--sb-badge-color, ${blue400});
  color: var(--sb-badge-text-color, ${colorTextPrimary});
`

const PlaceholderTextContainer = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;
`

const PlaceholderText = styled.div`
  ${headline3};
  font-size: 28px;
  line-height: 40px;
`

const ChannelBadgeImage = styled.img`
  ${badgeCommon};
  object-fit: cover;
`

export interface ChannelBadgeProps {
  channelInfo: ReadonlyDeep<ChannelInfo>
  className?: string
}

export function ChannelBadge({ channelInfo, className }: ChannelBadgeProps) {
  if (channelInfo.badgePath) {
    return (
      <ChannelBadgeImage
        src={channelInfo.badgePath}
        className={className}
        alt={`${channelInfo.name} badge`}
        draggable={false}
      />
    )
  }

  const badgeColor = randomColorForString(channelInfo.name)
  const textColor = meetsContrastGuidelines(badgeColor, colorTextPrimary).AA
    ? colorTextPrimary
    : colorTextInvert

  return (
    <ChannelBadgePlaceholder
      width='40'
      height='40'
      viewBox='0 0 40 40'
      preserveAspectRatio='xMinYMin meet'
      className={className}
      style={
        {
          '--sb-badge-color': badgeColor,
          '--sb-badge-text-color': textColor,
        } as any
      }>
      <foreignObject width='100%' height='100%'>
        <PlaceholderTextContainer>
          <PlaceholderText>{(channelInfo.name[0] ?? '-').toUpperCase()}</PlaceholderText>
        </PlaceholderTextContainer>
      </foreignObject>
    </ChannelBadgePlaceholder>
  )
}
