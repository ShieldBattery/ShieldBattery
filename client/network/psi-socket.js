import WrappedSocket from './wrapped-socket'

const psiSocket = new WrappedSocket('wss://lifeoflively.net:33198')
psiSocket.connect()

export default psiSocket
