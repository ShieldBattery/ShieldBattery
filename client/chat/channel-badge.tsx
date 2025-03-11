import React from 'react'
import styled, { css } from 'styled-components'
import { SbChannelId } from '../../common/chat'
import { randomColorForString } from '../avatars/colors'
import { useAppSelector } from '../redux-hooks'
import { pickTextColor } from '../styles/colors'
import { headlineLarge } from '../styles/typography'

const badgeCommon = css`
  width: 40px;
  height: 40px;
  border-radius: 9999px;
  contain: content;
`

const ChannelBadgePlaceholder = styled.svg`
  ${badgeCommon};
  background-color: var(--sb-badge-color, var(--color-blue70));
  color: var(--sb-badge-text-color, var(--theme-on-surface));
`

const PlaceholderTextContainer = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;
`

const PlaceholderText = styled.div`
  ${headlineLarge};
  font-size: 28px;
  line-height: 40px;
`

const ChannelBadgeImage = styled.img`
  ${badgeCommon};
  object-fit: cover;
`

export interface ChannelBadgeProps {
  src?: string
  channelName: string
  className?: string
  testName?: string
}

export function ChannelBadge({ src, channelName, className, testName }: ChannelBadgeProps) {
  if (src) {
    return (
      <ChannelBadgeImage
        src={src}
        className={className}
        alt={`${channelName} badge`}
        draggable={false}
        data-test={testName}
      />
    )
  }

  const badgeColor = randomColorForString(channelName)
  const textColor = pickTextColor(badgeColor)

  return (
    <ChannelBadgePlaceholder
      width='40'
      height='40'
      viewBox='0 0 40 40'
      preserveAspectRatio='xMinYMin meet'
      className={className}
      data-test={testName}
      style={
        {
          '--sb-badge-color': badgeColor,
          '--sb-badge-text-color': textColor,
        } as any
      }>
      <foreignObject width='100%' height='100%'>
        <PlaceholderTextContainer>
          <PlaceholderText>{(channelName[0] ?? '-').toUpperCase()}</PlaceholderText>
        </PlaceholderTextContainer>
      </foreignObject>
    </ChannelBadgePlaceholder>
  )
}

const LoadingBadge = styled.div`
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;

  background-color: var(--theme-skeleton);
  border-radius: 100%;
`

export interface ConnectedChannelBadgeProps {
  channelId: SbChannelId
  className?: string
  testName?: string
}

export function ConnectedChannelBadge({
  channelId,
  className,
  testName,
}: ConnectedChannelBadgeProps) {
  const basic = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const detailed = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId))

  return basic && detailed ? (
    <ChannelBadge
      src={detailed.badgePath}
      channelName={basic.name}
      className={className}
      testName={testName}
    />
  ) : (
    <LoadingBadge className={className} data-test={testName} />
  )
}
