var prefix = '~'

function SimpleMap() {
  this._map = Object.create(null)
}

SimpleMap.prototype.has = function(key) {
  return (prefix + key) in this._map
}

SimpleMap.prototype.get = function(key) {
  return this._map[prefix + key]
}

SimpleMap.prototype.put = function(key, value) {
  this._map[prefix + key] = value
}

SimpleMap.prototype.del = function(key) {
  delete this._map[prefix + key]
}

SimpleMap.prototype.forEach = function(f) {
  Object.keys(this._map).forEach(function(key) {
    f(key.substr(1), this._map[key])
  })
}

SimpleMap.prototype.keys = function() {
  return Object.keys(this._map).map(function(key) { return key.substr(1) })
}

module.exports = SimpleMap
