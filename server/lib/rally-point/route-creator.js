import Creator from 'rally-point-creator'

class RouteCreator {
  constructor() {
    this._creator = null
  }

  initialize(host, port, secret) {
    if (this._creator != null) {
      throw new Error('Already initialized')
    }

    this._creator = new Creator(host, port, secret)
    return this._creator.bind()
  }

  createRoute({ address4, port }) {
    return this._creator.createRoute(address4, port)
  }
}

export default new RouteCreator()
