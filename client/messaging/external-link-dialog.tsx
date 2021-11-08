import React, { MouseEvent, useCallback } from 'react'
import styled from 'styled-components'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { RaisedButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { mergeLocalSettings } from '../settings/action-creators'
import { body2 } from '../styles/typography'

const LinkAsText = styled.span`
  ${body2};
  overflow-wrap: anywhere;
  user-select: text;
`

interface ExternalLinkDialogProps extends CommonDialogProps {
  host: string
  href: string
}

export default function ExternalLinkDialog(props: ExternalLinkDialogProps) {
  const { host, href, onCancel } = props
  const trustedHosts: string[] = useAppSelector(s => s.settings.local.trustedHosts)
  const dispatch = useAppDispatch()

  const onOpenLinkClick = useCallback(
    (e: MouseEvent) => {
      dispatch(closeDialog())

      if (e.currentTarget.id === 'trust-host-link') {
        dispatch(mergeLocalSettings({ trustedHosts: [host, ...trustedHosts] }))
      } else {
        window.open(href, '_blank')
      }
    },
    [dispatch, host, trustedHosts, href],
  )

  const buttons = [
    <TextButton label='Cancel' key='cancel' onClick={onCancel} />,
    <RaisedButton label='Open Link' key='open-link' color='primary' onClick={onOpenLinkClick} />,
  ]

  return (
    <Dialog
      title='External link'
      showCloseButton={true}
      onCancel={onCancel}
      buttons={buttons}
      dialogRef={props.dialogRef}>
      <p>
        You are going to visit <LinkAsText title={href}>{clampString(href, 192)}</LinkAsText> which
        is outside of ShieldBattery.
      </p>
      <br />
      <a
        href={href}
        target='_blank'
        rel='noopener nofollow'
        id='trust-host-link'
        onClick={onOpenLinkClick}
        title={`Mark host as trusted and open ${href}`}>
        Always trust <LinkAsText>{clampString(host, 64)}</LinkAsText> links
      </a>
    </Dialog>
  )
}

function clampString(str: string, length: number, postfix = '...') {
  return str.length > length ? str.slice(0, length - postfix.length) + postfix : str
}
