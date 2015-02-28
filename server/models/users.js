// User model, corresponding to a user account on the site (with a login, password, etc.)
var db = require('../db')
  , permissions = require('./permissions')

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
  if (!this._fromDb) {
    this._insert(cb)
  } else {
    this._update(cb)
  }
}

function beginTransaction(cb) {
  db(function(err, client, done) {
    if (err) return cb(err)

    client.query('BEGIN', function(err) {
      if (err) {
        client.query('ROLLBACK', done)
        return cb(err)
      }

      cb(null, client, function(err, commitCb) {
        if (err) {
          return client.query('ROLLBACK', done)
        }

        client.query('COMMIT', function(err) {
          done(err)
          commitCb(err)
        })
      })
    })
  })
}

User.prototype._insert = function(cb) {
  var query
    , params
  query = 'INSERT INTO users (name, email, password, created) ' +
      'VALUES ($1, $2, $3, $4) RETURNING id'
  params = [ this.name, this.email, this.password, this.created ]

  var self = this
  beginTransaction(function(err, client, done) {
    if (err) return cb(err)

    client.query(query, params, insertCb)

    function insertCb(err, result) {
      if (err) {
        done(err)
        return cb(err)
      }

      if (result.rows.length < 1) {
        var lengthError = new Error('No rows returned')
        done(lengthError)
        return cb(lengthError)
      }

      self.id = result.rows[0].id
      self._fromDb = true

      permissions.create(client, self.id, permissionsCb)
    }

    function permissionsCb(err, userPermissions) {
      if (err) {
        done(err)
        return cb(err)
      }

      done(null, function(err) {
        if (err) return cb(err)

        cb(null, self, userPermissions)
      })
    }
  })
}

User.prototype._update = function(cb) {
  var query
    , params
  if (!this.id) return cb(new Error('Incomplete data'))
  query = 'UPDATE users SET name = $1, email = $2, password = $3, created = $4 WHERE id = $5'
  params = [ this.name, this.email, this.password. this.created, this.id ]

  var self = this
  db(function(err, client, done) {
    if (err) return cb(err)

    client.query(query, params, function(err, result) {
      done()
      if (err) return cb(err)

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
