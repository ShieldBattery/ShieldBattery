export interface SentEmail {
  to: string
  from: string
  subject: string
  template: string
  /** The tag of the template version that was sent, which identifies the email's language. */
  version: string
  templateVariables: Record<string, any>
}
