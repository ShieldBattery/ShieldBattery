import type { NydusClient, RouteInfo } from 'nydus-client'
import { NewsEvent } from '../../common/news'
import { dispatch, Dispatchable } from '../dispatch-registry'
import { urgentMessageId } from '../home/last-seen-urgent-message'
import { jotaiStore } from '../jotai-store'
import { latestNewsPostId } from './last-seen-news-post'

type EventToNewsActionMap = {
  [E in NewsEvent['type']]: (
    event: Extract<NewsEvent, { type: E }>,
  ) => Dispatchable | undefined | void
}

const eventToAction: EventToNewsActionMap = {
  urgentMessageChange(event) {
    jotaiStore.set(urgentMessageId, event.id)
  },
  newsPostChange(event) {
    jotaiStore.set(latestNewsPostId, event.id)
  },
}

function handleNewsEvent(_route: RouteInfo, event: NewsEvent) {
  const action = eventToAction[event.type]?.(event as any)
  if (action) {
    dispatch(action)
  }
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/news', handleNewsEvent)
  siteSocket.registerRoute('/newsPosts', handleNewsEvent)
}
