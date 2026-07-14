export type NewsEvent = UrgentMessageChangeEvent | NewsPostChangeEvent

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

export type NewsPostChangeEvent =
  | {
      type: 'newsPostChange'
      publishedAt?: undefined
      id?: undefined
    }
  | {
      type: 'newsPostChange'
      publishedAt: number
      id: string
    }
