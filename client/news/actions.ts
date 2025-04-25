import { UrgentMessageChangeEvent } from '../../common/news'

export type NewsActions = UrgentMessageChange

export interface UrgentMessageChange {
  type: '@news/urgentMessageChange'
  payload: UrgentMessageChangeEvent
}
