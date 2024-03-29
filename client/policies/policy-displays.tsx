import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { policyTypeToLabel, SbPolicyType } from '../../common/policies/policy-type'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { BottomLinks } from '../landing/bottom-links'
import TopLinks from '../landing/top-links'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { body1, body2, headline3, headline5, subtitle1 } from '../styles/typography'

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
      title={t('policy.acceptableUse', 'Acceptable use')}
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <React.Suspense fallback={<LoadingDotsArea />}>
        <AcceptableUseContent />
      </React.Suspense>
    </Dialog>
  )
}

export function AcceptableUsePage() {
  const { t } = useTranslation()
  return (
    <PolicyPage title={policyTypeToLabel(SbPolicyType.AcceptableUse, t)}>
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
      title={t('policy.privacyPolicy', 'Privacy policy')}
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <React.Suspense fallback={<LoadingDotsArea />}>
        <PrivacyPolicyContent />
      </React.Suspense>
    </Dialog>
  )
}

export function PrivacyPolicyPage() {
  const { t } = useTranslation()
  return (
    <PolicyPage title={policyTypeToLabel(SbPolicyType.Privacy, t)}>
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
      title={t('policy.termsOfService', 'Terms of service')}
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <React.Suspense fallback={<LoadingDotsArea />}>
        <TermsOfServiceContent />
      </React.Suspense>
    </Dialog>
  )
}

export function TermsOfServicePage() {
  const { t } = useTranslation()
  return (
    <PolicyPage title={policyTypeToLabel(SbPolicyType.TermsOfService, t)}>
      <TermsOfServiceContent />
    </PolicyPage>
  )
}
