import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import i18n from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
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
  startingText = i18n.t('navigation.copyLink.defaultText', 'Copy link'),
  copiedText = i18n.t('navigation.copyLink.copiedText', 'Copied!'),
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
      <StyledIconButton
        className={className}
        icon={<MaterialIcon icon='link' />}
        onClick={onClick}
      />
    </Tooltip>
  )
}
