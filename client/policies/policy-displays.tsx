import React from 'react'
import styled from 'styled-components'
import { policyTypeToLabel, SbPolicyType } from '../../common/policies/policy-type'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { BottomLinks } from '../landing/bottom-links'
import TopLinks from '../landing/top-links'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { body1, body2, headline3, headline5, subtitle1 } from '../styles/typography'
import { useTranslation } from 'react-i18next'

const PolicyRoot = styled.div`
  ${body1};
  user-select: text;

  & * {
    user-select: text;
  }

  h3 {
    ${headline5};
  }

  h4 {
    ${subtitle1};
    font-weight: 500;
  }

  h5 {
    ${body2};
  }

  b,
  strong {
    font-weight: 500;
  }
`

const PageRoot = styled.div`
  width: 100%;
  overflow: auto;
`

const PageContentRoot = styled.div`
  max-width: 840px;
  margin: 0 auto !important;
  padding-right: var(--pixel-shove-x, 0) !important;
`

const PageHeader = styled.div`
  ${headline3};
  margin-bottom: 16px;
`

function PolicyPage(props: { title: string; children: React.ReactNode }) {
  return (
    <PageRoot>
      <PageContentRoot>
        <TopLinks />
        <PageHeader>{props.title}</PageHeader>
        <React.Suspense fallback={<LoadingDotsArea />}>{props.children}</React.Suspense>
        <BottomLinks />
      </PageContentRoot>
    </PageRoot>
  )
}

const AcceptableUseContent = React.lazy(async () => {
  const { default: policy } = await import('../../common/policies/acceptable-use.html')
  return { default: () => <PolicyRoot dangerouslySetInnerHTML={{ __html: policy }} /> }
})

export function AcceptableUseDialog(props: CommonDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      title={t('policies.policyDisplays.acceptableUseTitle', 'Acceptable use')}
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <AcceptableUseContent />
    </Dialog>
  )
}

export function AcceptableUsePage() {
  return (
    <PolicyPage title={policyTypeToLabel(SbPolicyType.AcceptableUse)}>
      <AcceptableUseContent />
    </PolicyPage>
  )
}

const PrivacyPolicyContent = React.lazy(async () => {
  const { default: policy } = await import('../../common/policies/privacy.html')
  return { default: () => <PolicyRoot dangerouslySetInnerHTML={{ __html: policy }} /> }
})

export function PrivacyPolicyDialog(props: CommonDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      title={t('policies.policyDisplays.privacyPolicyTitle', 'Privacy policy')}
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <PrivacyPolicyContent />
    </Dialog>
  )
}

export function PrivacyPolicyPage() {
  return (
    <PolicyPage title={policyTypeToLabel(SbPolicyType.Privacy)}>
      <PrivacyPolicyContent />
    </PolicyPage>
  )
}

const TermsOfServiceContent = React.lazy(async () => {
  const { default: policy } = await import('../../common/policies/terms-of-service.html')
  return { default: () => <PolicyRoot dangerouslySetInnerHTML={{ __html: policy }} /> }
})

export function TermsOfServiceDialog(props: CommonDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      title={t('policies.policyDisplays.termsOfServiceTitle', 'Terms of service')}
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <TermsOfServiceContent />
    </Dialog>
  )
}

export function TermsOfServicePage() {
  return (
    <PolicyPage title={policyTypeToLabel(SbPolicyType.TermsOfService)}>
      <TermsOfServiceContent />
    </PolicyPage>
  )
}
