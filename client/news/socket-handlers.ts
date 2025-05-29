import { NydusClient } from 'nydus-client'
import { NewsEvent } from '../../common/news'
import { dispatch, Dispatchable } from '../dispatch-registry'
import { urgentMessageId } from '../home/last-seen-urgent-message'
import { getJotaiStore } from '../jotai-store'

type EventToNewsActionMap = {
  [E in NewsEvent['type']]: (
    event: Extract<NewsEvent, { type: E }>,
  ) => Dispatchable | undefined | void
}

const eventToAction: EventToNewsActionMap = {
  urgentMessageChange(event) {
    getJotaiStore().set(urgentMessageId, event.id)
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
