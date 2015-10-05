import createNydus from 'nydus-client'

const psiSocket = createNydus('wss://lifeoflively.net:33198')
psiSocket.connect()

export default psiSocket
