import React, { useCallback } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TransInterpolation } from '../i18n/i18next'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { addTrustedDomain } from '../messaging/action-creators'
import { useAppDispatch } from '../redux-hooks'
import { Subtitle1, singleLine, subtitle2 } from '../styles/typography'

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
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const onOpenLinkClick = useCallback(() => {
    dispatch(closeDialog(DialogType.ExternalLink))
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
      {t('navigation.externalLink.alwaysTrust', 'Always trust this domain')}
    </TrustDomainLink>,
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      color='accent'
      onClick={onCancel}
    />,
    <TextButton
      label={t('navigation.externalLink.openLink', 'Open Link')}
      key='open-link'
      color='accent'
      onClick={onOpenLinkClick}
    />,
  ]

  return (
    <StyledDialog
      title={t('navigation.externalLink.title', 'External link')}
      showCloseButton={true}
      onCancel={onCancel}
      buttons={buttons}
      dialogRef={dialogRef}>
      <SelectionBoundary>
        <Trans t={t} i18nKey='navigation.externalLink.dialogText'>
          <Subtitle1>This link will take you to a site outside ShieldBattery:</Subtitle1>
          <LinkAsText title={href}>{{ link: href } as TransInterpolation}</LinkAsText>
          <Subtitle1>Are you sure you want to go there?</Subtitle1>
        </Trans>
      </SelectionBoundary>
    </StyledDialog>
  )
}
