export interface ClientProof {
  keyId: number
  body: string
  signature: string
}

export interface SignupFields {
  username: string
  password: string
  email: string
  locale?: string
  signupCode?: string
}

export type SignupChallengeResponse =
  | { required: false }
  | { required: true; attemptId: string; nonce: string; requestHash: string }
