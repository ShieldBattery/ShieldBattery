export interface SentEmail {
  to: string
  from: string
  subject: string
  text?: string
  // TODO(tec27): Update required fields once text is no longer used
  template?: string
  templateVariables?: Record<string, any>
}
