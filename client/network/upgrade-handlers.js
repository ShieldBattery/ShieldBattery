import { UPGRADE_PSI_INFO } from '../actions'
import { dispatch } from '../dispatch-registry'

export default function registerModule({ siteSocket }) {
  siteSocket.registerRoute('/psiVersion', (route, event) => {
    dispatch({
      type: UPGRADE_PSI_INFO,
      payload: event,
    })
  })
}
