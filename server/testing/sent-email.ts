export interface SentEmail {
  to: string
  from: string
  subject: string
  template: string
  templateVariables: Record<string, any>
}
