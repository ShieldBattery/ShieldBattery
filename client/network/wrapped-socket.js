import nydus from 'nydus-client'
import { EventEmitter } from 'events'

// TODO(tec27): Rework the API of nydus-client such that this wrapper is unnecessary
class WrappedSocket extends EventEmitter {
  constructor(host) {
    super()
    this.host = host
    this.lastError = null

    if (!this.host) {
      this.host = (location.protocol == 'https' ? 'wss://' : 'ws://') +
          location.hostname + ':' + location.port
    }

    ;[ 'call', 'subscribe', 'unsubscribe', 'publish' ].forEach(f => {
      let self = this
      self[f] = function() {
        self.socket[f].apply(self.socket, arguments)
      }
    })

    // we'd rather not have socket errors cause a bunch of console spam for no good reason
    this.on('error', function() {})
  }

  get connected() {
    return this.socket && this.socket.readyState == 'connected'
  }

  get router() {
    return this.socket.router
  }

  connect() {
    if (this.connected) return

    this.socket = nydus(this.host)
    this.socket.on('connect', () => this._onConnect())
      .on('error', err => this._onError(err))
      .on('disconnect', () => this._onDisconnect())

    return this
  }

  disconnect() {
    if (!this.connected) return

    this.socket.close()
    return this
  }

  _onConnect() {
    console.log(`socket connected [${this.host}]`)
    this.emit('connect')
  }

  _onError(err) {
    console.log(`socket error! [${this.host}]`)
    console.dir(err)
    this.emit('error', err)
  }

  _onDisconnect() {
    console.log(`socket disconnected [${this.host}]`)
    this.emit('disconnect')
  }
}

;['addListener',
  'on',
  'once',
  'removeListener',
  'removeAllListeners',
  'listeners',
].forEach(method => {
  let origMethod = WrappedSocket.prototype[method]
  WrappedSocket.prototype[method] = genEventEmitterMethod(method, origMethod)
})

function genEventEmitterMethod(method, origMethod) {
  return function(ev, fn) {
    switch(ev) {
      case 'connect':
      case 'disconnect':
      case 'error':
        return origMethod.call(this, ev, fn)
      default:
        this.socket[method](ev, fn)
        return this
    }
  }
}

export default WrappedSocket
