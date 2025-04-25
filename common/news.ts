export type NewsEvent = UrgentMessageChangeEvent

export interface UrgentMessageChangeEvent {
  type: 'urgentMessageChange'
  publishedAt?: number
}
