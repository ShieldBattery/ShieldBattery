import { LOCAL_SETTINGS_UPDATE } from '../actions'
import { dispatch } from '../dispatch-registry'

export default function registerModule({ psiSocket }) {
  psiSocket.registerRoute('/settings', (route, event) => {
    dispatch({
      type: LOCAL_SETTINGS_UPDATE,
      payload: event
    })
  })
}
