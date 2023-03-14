import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import LinkIcon from '../icons/material/link-24px.svg'
import { IconButton } from '../material/button'
import { Tooltip, TooltipPosition } from '../material/tooltip'
import { makeServerUrl } from '../network/server-url'
import { useStableCallback } from '../state-hooks'
import { colorTextFaint, colorTextSecondary } from '../styles/colors'

const StyledIconButton = styled(IconButton)`
  color: ${colorTextFaint};

  &:hover {
    color: ${colorTextSecondary};
  }
`

function getCurrentUrl() {
  if (IS_ELECTRON) {
    return makeServerUrl(window.location.pathname)
  } else {
    return window.location.href
  }
}

export interface CopyLinkButtonProps {
  className?: string
  tooltipPosition?: TooltipPosition
  startingText?: string
  copiedText?: string
}

export function CopyLinkButton({
  className,
  tooltipPosition,
  startingText = 'Copy link',
  copiedText = 'Copied!',
}: CopyLinkButtonProps) {
  const [text, setText] = useState(startingText)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  const onClick = useStableCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    navigator.clipboard.writeText(getCurrentUrl())
    setText(copiedText)

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = undefined
      setText(startingText)
    }, 2000)
  })

  useEffect(() => {
    if (!timeoutRef.current) {
      setText(startingText)
    }
  }, [startingText])

  useEffect(() => {
    if (timeoutRef.current) {
      setText(copiedText)
    }
  }, [copiedText])

  return (
    <Tooltip text={text} position={tooltipPosition}>
      <StyledIconButton className={className} icon={<LinkIcon />} onClick={onClick} />
    </Tooltip>
  )
}
