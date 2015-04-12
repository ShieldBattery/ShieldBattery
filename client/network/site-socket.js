import WrappedSocket from './wrapped-socket'
import authStore from '../auth/auth-store'

let siteSocket = new WrappedSocket(null)

if (authStore.isLoggedIn) {
  siteSocket.connect()
}

authStore.register(() => {
  if (authStore.isLoggedIn && !siteSocket.connected) {
    siteSocket.connect()
  } else if (!authStore.isLoggedIn && siteSocket.connected) {
    siteSocket.disconnect()
  }
})

export default siteSocket
