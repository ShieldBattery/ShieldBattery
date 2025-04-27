export type NewsEvent = UrgentMessageChangeEvent

export type UrgentMessageChangeEvent =
  | {
      type: 'urgentMessageChange'
      publishedAt?: undefined
      id?: undefined
    }
  | {
      type: 'urgentMessageChange'
      publishedAt: number
      id: string
    }
