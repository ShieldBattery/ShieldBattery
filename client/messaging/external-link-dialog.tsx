import React, { useCallback } from 'react'
import styled from 'styled-components'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch } from '../redux-hooks'
import { singleLine, Subtitle1, subtitle2 } from '../styles/typography'
import { addTrustedDomain } from './action-creators'

const StyledDialog = styled(Dialog)`
  max-width: 640px;
`

const SelectionBoundary = styled.div`
  user-select: contain;

  & * {
    user-select: text;
  }
`

const LinkAsText = styled.div`
  ${subtitle2};
  ${singleLine}

  width: 100%;
  padding: 16px 0;

  overflow: hidden;
  text-overflow: ellipsis;
`

const TrustDomainLink = styled.a`
  height: 36px;
  margin: 6px 0;
  padding: 0 20px;

  float: left;
  line-height: 36px;
`

interface ExternalLinkDialogProps extends CommonDialogProps {
  domain: string
  href: string
}

export function ExternalLinkDialog({ href, domain, onCancel, dialogRef }: ExternalLinkDialogProps) {
  const dispatch = useAppDispatch()

  const onOpenLinkClick = useCallback(() => {
    dispatch(closeDialog())
    window.open(href, '_blank', 'noopener,noreferrer')
  }, [dispatch, href])

  const onTrustDomainClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dispatch(addTrustedDomain(domain))
      onOpenLinkClick()
    },
    [dispatch, domain, onOpenLinkClick],
  )

  const buttons = [
    <TrustDomainLink key='trust-domain' href='#' onClick={onTrustDomainClick}>
      Always trust this domain
    </TrustDomainLink>,
    <TextButton label='Cancel' key='cancel' color='accent' onClick={onCancel} />,
    <TextButton label='Open Link' key='open-link' color='accent' onClick={onOpenLinkClick} />,
  ]

  return (
    <StyledDialog
      title='External link'
      showCloseButton={true}
      onCancel={onCancel}
      buttons={buttons}
      dialogRef={dialogRef}>
      <SelectionBoundary>
        <Subtitle1>This link will take you to a site outside ShieldBattery:</Subtitle1>
        <LinkAsText title={href}>{href}</LinkAsText>
        <Subtitle1>Are you sure you want to go there?</Subtitle1>
      </SelectionBoundary>
    </StyledDialog>
  )
}
