export interface EmailProps {
  /** The language this email is in. This should be in BCP-47 format. */
  lang?: string
  /** The directionality of the text in this email. */
  dir?: 'ltr' | 'rtl' | 'auto'
}
