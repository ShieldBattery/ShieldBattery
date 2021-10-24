import { assertUnreachable } from '../assert-unreachable'

/** The different types of legal/usage policies we provide. */
export enum SbPolicyType {
  AcceptableUse = 'acceptableUse',
  Privacy = 'privacy',
  TermsOfService = 'termsOfService',
}

export const ALL_POLICY_TYPES: Readonly<SbPolicyType[]> = Object.values(SbPolicyType)

export function policyTypeToLabel(policyType: SbPolicyType): string {
  switch (policyType) {
    case SbPolicyType.AcceptableUse:
      return 'Acceptable Use Policy'
    case SbPolicyType.Privacy:
      return 'Privacy Policy'
    case SbPolicyType.TermsOfService:
      return 'Terms of Service'
    default:
      return assertUnreachable(policyType)
  }
}
