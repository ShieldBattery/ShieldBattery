import createNydus from 'nydus-client'

const psiSocket = createNydus('ws://localhost:33198')
psiSocket.connect()

export default psiSocket
