const prefix = '~'

export default class SimpleMap {
  constructor() {
    this._map = Object.create(null)
  }

  has(key) {
    return (prefix + key in this._map)
  }

  get(key) {
    return this._map[prefix + key]
  }

  put(key, value) {
    this._map[prefix + key] = value
  }

  del(key) {
    delete this._map[prefix + key]
  }

  forEach(f) {
    Object.keys(this._map).forEach(function(key) {
      f(key.substr(1), this._map[key])
    })
  }

  keys() {
    return Object.keys(this._map).map(function(key) {
      return key.substr(1)
    })
  }
}
