import { NydusClient } from 'nydus-client'
import { NewsEvent } from '../../common/news'
import { dispatch, Dispatchable } from '../dispatch-registry'

type EventToNewsActionMap = {
  [E in NewsEvent['type']]: (event: Extract<NewsEvent, { type: E }>) => Dispatchable | undefined
}

const eventToAction: EventToNewsActionMap = {
  urgentMessageChange(event) {
    return {
      type: '@news/urgentMessageChange',
      payload: event,
    }
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/news', (_route, event: NewsEvent) => {
    const action = eventToAction[event.type]?.(event)
    if (action) {
      dispatch(action)
    }
  })
}
