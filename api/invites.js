var constants = require('../util/constants')
  , createRouter = require('express').Router
  , invites = require('../models/invites')
  , httpErrors = require('../util/http-errors')
  , checkPermissions = require('../util/check-permissions')
  , cuid = require('cuid')

module.exports = function() {
  var router = createRouter()
  router
    .post('/', createInvite)
    .get('/', checkPermissions(['acceptInvites']), listInvites)
    .put('/:email', checkPermissions(['acceptInvites']), acceptInvite)

  return router
}

function createInvite(req, res, next) {
  var invite =  { email: req.body.email
                , teamliquidName: req.body.teamliquidName
                , os: req.body.os
                , browser: req.body.browser
                , graphics: req.body.graphics
                , canHost: req.body.canHost
                }
  if (!invite.email || !constants.isValidEmail(invite.email)) {
    return next(new httpErrors.BadRequestError('Invalid email'))
  }

  invites.create(invite, function(err) {
    if (err) {
      req.log.error({ err: err }, 'error creating invite')
      return next(err)
    }

    res.status(201).end()
  })
}

function listInvites(req, res, next) {
  if (req.query.accepted) {
    if (req.query.accepted == 'true') {
      invites.getAccepted(onInvites)
    } else {
      invites.getUnaccepted(onInvites)
    }
  } else {
    invites.getAll(onInvites)
  }

  function onInvites(err, invites) {
    if (err) {
      req.log.error({ err: err }, 'error getting invites')
      return next(err)
    }

    res.send(invites)
  }
}

function acceptInvite(req, res, next) {
  if (!constants.isValidEmail(req.params.email)) {
    return next(new httpErrors.BadRequestError('Invalid email'))
  }
  if (!req.body.isAccepted) {
    return next(new httpErrors.NotImplementedError('Not implemented'))
  }

  var token = cuid()
  invites.accept(req.params.email, token, function(err, invite) {
    if (err) {
      req.log.error({ err: err }, 'error accepting invite')
      return next(err)
    }

    res.send(invite)
  })
}
