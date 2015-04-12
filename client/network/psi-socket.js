import WrappedSocket from './wrapped-socket'

let psiSocket = new WrappedSocket('wss://lifeoflively.net:33198')
psiSocket.connect()

export default psiSocket
