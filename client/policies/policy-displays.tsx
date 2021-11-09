import loadable from '@loadable/component'
import React from 'react'
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
      <TopLinks />
      <PageHeader>{props.title}</PageHeader>
      {props.children}
      <BottomLinks />
    </PageRoot>
  )
}

const AcceptableUseContent = loadable(
  async () => {
    const { default: policy } = await import('../../common/policies/acceptable-use.html')
    return () => <PolicyRoot dangerouslySetInnerHTML={{ __html: policy }} />
  },
  {
    fallback: <LoadingDotsArea />,
  },
)

export function AcceptableUseDialog(props: CommonDialogProps) {
  return (
    <Dialog
      title='Acceptable use'
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

const PrivacyPolicyContent = loadable(
  async () => {
    const { default: policy } = await import('../../common/policies/privacy.html')
    return () => <PolicyRoot dangerouslySetInnerHTML={{ __html: policy }} />
  },
  {
    fallback: <LoadingDotsArea />,
  },
)

export function PrivacyPolicyDialog(props: CommonDialogProps) {
  return (
    <Dialog
      title='Privacy policy'
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

const TermsOfServiceContent = loadable(
  async () => {
    const { default: policy } = await import('../../common/policies/terms-of-service.html')
    return () => <PolicyRoot dangerouslySetInnerHTML={{ __html: policy }} />
  },
  {
    fallback: <LoadingDotsArea />,
  },
)

export function TermsOfServiceDialog(props: CommonDialogProps) {
  return (
    <Dialog
      title='Terms of service'
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
