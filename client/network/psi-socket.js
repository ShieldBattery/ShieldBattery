import createNydus from 'nydus-client'

const psiSocket = createNydus('wss://lifeoflively.net:33198')
// TODO(tec27): psiSocket.connect() once psi supports latest nydus

export default psiSocket
