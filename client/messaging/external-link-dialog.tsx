import React, { MouseEvent, useCallback } from 'react'
import styled, { css } from 'styled-components'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { RaisedButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { mergeLocalSettings } from '../settings/action-creators'
import { body2 } from '../styles/typography'

const veryLongLinkStyles = css`
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
`

const LinkAsText = styled.span<{ isLong?: boolean }>`
  ${body2};
  overflow-wrap: anywhere;
  user-select: all;
  ${props => (props.isLong ? veryLongLinkStyles : '')}
`

interface ExternalLinkDialogProps extends CommonDialogProps {
  domain: string
  href: string
}

export default function ExternalLinkDialog(props: ExternalLinkDialogProps) {
  const { href, domain, onCancel } = props
  const trustedDomains = useAppSelector(s => s.settings.local.trustedDomains)
  const dispatch = useAppDispatch()

  const onOpenLinkClick = useCallback(
    (e: MouseEvent) => {
      dispatch(closeDialog())

      if (e.currentTarget.id === 'trust-domain-link') {
        dispatch(mergeLocalSettings({ trustedDomains: [domain, ...trustedDomains] }))
      } else {
        window.open(href, '_blank', 'noopener,noreferrer')
      }
    },
    [dispatch, trustedDomains, href, domain],
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
        You are going to visit{' '}
        <LinkAsText title={`(click to select) ${href}`} isLong={href.length > 256}>
          {href}
        </LinkAsText>{' '}
        which is outside of ShieldBattery.
      </p>
      <a
        href={href}
        target='_blank'
        rel='noopener nofollow noreferrer'
        id='trust-domain-link'
        onClick={onOpenLinkClick}
        title={`Mark ${domain} as trusted domain and open the link`}>
        Trust this domain
      </a>
    </Dialog>
  )
}
