import { SERVER_STATUS } from '../actions'
import * as registry from '../dispatch-registry'

export default function registerModule({ siteSocket }) {
  siteSocket.registerRoute('/status',
      (route, event) => registry.dispatch({ type: SERVER_STATUS, payload: event }))
}
