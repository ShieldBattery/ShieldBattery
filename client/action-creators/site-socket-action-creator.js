import siteSocket from '../network/site-socket'

// An action creator that creates standard site socket actions. The parameters are:
// `beginAction` - an action that is dispatched before any network request to let the client know
//    that it's about to make a network request
// `action` - an action that invokes the site socket and which resolves with success/error of the
//    network request
// `route` - the route which should be invoked through the site socket
// `params` - an object containing all the parameters to send with the network request
export default function createSiteSocketAction(beginAction, action, route, params) {
  return dispatch => {
    dispatch({
      type: beginAction,
      payload: params,
    })

    dispatch({
      type: action,
      payload: siteSocket.invoke(route, params),
      meta: params,
    })
  }
}
