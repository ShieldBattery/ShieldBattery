import { TFunction } from 'i18next'
import { assertUnreachable } from '../assert-unreachable'

/** The different types of legal/usage policies we provide. */
export enum SbPolicyType {
  AcceptableUse = 'acceptableUse',
  Privacy = 'privacy',
  TermsOfService = 'termsOfService',
}

export const ALL_POLICY_TYPES: Readonly<SbPolicyType[]> = Object.values(SbPolicyType)

export function policyTypeToLabel(policyType: SbPolicyType, t: TFunction): string {
  switch (policyType) {
    case SbPolicyType.AcceptableUse:
      return t('policy.acceptableUseAllCaps', 'Acceptable Use Policy')
    case SbPolicyType.Privacy:
      return t('policy.privacyPolicyAllCaps', 'Privacy Policy')
    case SbPolicyType.TermsOfService:
      return t('policy.termsOfServiceAllCaps', 'Terms of Service')
    default:
      return assertUnreachable(policyType)
  }
}
