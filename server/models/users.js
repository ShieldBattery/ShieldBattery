// User model, corresponding to a user account on the site (with a login, password, etc.)
var db = require('../db')
  , permissions = require('./permissions')

function defPrivate(o, name, value) {
  Object.defineProperty(o, name, {
    enumerable: false,
    writable: true,
    value: value
  })
}

function* transact(next) {
  let { client, done } = yield db()
  try {
    yield client.queryPromise('BEGIN')
  } catch (err) {
    yield* rollbackFor(err, client, done)
  }

  try {
    let result = yield* next(client)
    yield client.queryPromise('COMMIT')
    done()
    return result
  } catch (err) {
    yield* rollbackFor(err, client, done)
  }
}

function* rollbackFor(err, client, done) {
  try {
    yield client.queryPromise('ROLLBACK')
  } catch (err) {
    done(err)
    throw err
  }

  done()
  throw err
}

class User {
  constructor(props, _fromDb) {
    defPrivate(this, '_fromDb', !!_fromDb)

    this.id = this._fromDb ? props.id : null
    this.name = props.name
    this.email = props.email
    defPrivate(this, 'password', props.password)
    this.created = props.created || new Date()
  }

  *save() {
    if (!this.name || !this.email || !this.password || !this.created) {
      throw new Error('Incomplete data')
    }
    // TODO(tec27): it's very strange that the return value changes here depending on whether its
    // an insert or an update, find a way to reconcile those
    if (!this._fromDb) {
      return yield* this._insert()
    } else {
      return yield* this._update()
    }
  }

  *_insert() {
    let query
      , params
    query = 'INSERT INTO users (name, email, password, created) ' +
        'VALUES ($1, $2, $3, $4) RETURNING id'
    params = [ this.name, this.email, this.password, this.created ]

    var self = this
    return yield* transact(function*(client) {
      let result = yield client.queryPromise(query, params)
      if (result.rows.length < 1) {
        throw new Error('No rows returned')
      }

      self.id = result.rows[0].id
      self._fromDb = true
      let userPermissions = yield* permissions.create(client, self.id)
      return { user: self, permissions: userPermissions }
    })
  }

  *_update() {
    let query
      , params
    if (!this.id) throw new Error('Incomplete data')
    query = 'UPDATE users SET name = $1, email = $2, password = $3, created = $4 WHERE id = $5'
    params = [ this.name, this.email, this.password. this.created, this.id ]

    let { client, done } = yield db()
    try {
      yield client.queryPromise(query, params)
      return this
    } finally {
      done()
    }
  }
}

function createUser(name, email, hashedPassword, createdDate) {
  return new User({
    name: name,
    email: email,
    password: hashedPassword,
    created: createdDate || new Date()
  })
}

function* findUser(criteria) {
  let query = 'SELECT id, name, email, password, created FROM users WHERE '
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

  let { client, done } = yield db()
  try {
    let result = yield client.queryPromise(query, params)
    return result.rows.length < 1 ? null : new User(result.rows[0], true)
  } finally {
    done()
  }
}

module.exports = {
  create: createUser,
  find: findUser
}
