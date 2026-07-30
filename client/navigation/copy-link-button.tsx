import { useRef, useState } from 'react'
import styled from 'styled-components'
import i18n from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { IconButton } from '../material/button'
import { Tooltip, TooltipPosition } from '../material/tooltip'
import { makeServerUrl } from '../network/server-url'

const StyledIconButton = styled(IconButton)`
  color: var(--theme-on-surface-variant);

  &:hover {
    color: var(--theme-amber);
  }
`

function getCurrentUrl() {
  if (IS_ELECTRON) {
    return makeServerUrl(window.location.pathname)
  } else {
    return window.location.href
  }
}

/**
 * Shared clipboard-write behavior for "copy link" style buttons: writes the URL returned by
 * `getUrl` to the clipboard and reports `copied` as true for 2 seconds afterward, so callers can
 * swap in "Copied!" style feedback.
 */
export function useLinkCopier(getUrl: () => string): [copied: boolean, copyLink: () => void] {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  function copyLink() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    navigator.clipboard
      .writeText(getUrl())
      .catch(err => logger.error('Error writing to clipboard: ' + (err?.stack ?? err)))
    setCopied(true)

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = undefined
      setCopied(false)
    }, 2000)
  }

  return [copied, copyLink]
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
  const [copied, copyLink] = useLinkCopier(getCurrentUrl)

  return (
    <Tooltip text={copied ? copiedText : startingText} position={tooltipPosition}>
      <StyledIconButton
        className={className}
        icon={<MaterialIcon icon='link' />}
        onClick={copyLink}
      />
    </Tooltip>
  )
}
