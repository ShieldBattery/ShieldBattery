// User model, corresponding to a user account on the site (with a login, password, etc.)
var db = require('../db')

function defPrivate(o, name, value) {
  Object.defineProperty(o, name,
      { enumerable: false
      , writable: true
      , value: value
      })
}

function User(props, _fromDb) {
  defPrivate(this, '_fromDb', !!_fromDb)

  this.id = this._fromDb ? props.id : null
  this.name = props.name
  this.email = props.email
  defPrivate(this, 'password', props.password)
  this.created = props.created || new Date()
}

User.prototype.save = function(cb) {
  if (!this.name || !this.email || !this.password || !this.created) {
    return cb(new Error('Incomplete data'))
  }
  var query
    , params
  if (!this._fromDb) {
    query = 'INSERT INTO users (name, email, password, created)' +
        'VALUES ($1, $2, $3, $4) RETURNING id'
    params = [ this.name, this.email, this.password, this.created ]
  } else {
    if (!this.id) return cb(new Error('Incomplete data'))
    query = 'UPDATE users SET name = $1, email = $2, password = $3, created = $4 WHERE id = $5'
    params = [ this.name, this.email, this.password. this.created, this.id ]
  }

  var self = this
  db(function(err, client, done) {
    if (err) return cb(err)

    client.query(query, params, function(err, result) {
      done()
      if (err) return cb(err)

      if (!self._fromDb) {
        if (result.rows.length < 1) return cb(new Error('No rows returned'))

        self.id = result.rows[0].id
        self._fromDb = true
      }

      return cb(null, self)
    })
  })
}

function createUser(name, email, hashedPassword, createdDate) {
  return new User(
      { name: name
      , email: email
      , password: hashedPassword
      , created: createdDate || new Date()
      })
}

function findUser(criteria, cb) {
  var query = 'SELECT id, name, email, password, created FROM users WHERE '
    , params
  if (typeof criteria != 'number') {
    // by name
    query += 'name = $1'
    params = [ criteria + '' ]
  } else {
    // by id
    query += 'id = $1'
    params = [ criteria ]
  }

  db(function(err, client, done) {
    if (err) return cb(err)

    client.query(query, params, function(err, result) {
      done()
      if (err) return cb(err)
      else if (result.rows.length < 1) return cb(null, null)

      return cb(null, new User(result.rows[0], true))
    })
  })
}

module.exports =
    { create: createUser
    , find: findUser
    }
