var permissions = require('../models/permissions')
  , checkPermissions = require('../util/check-permissions')
  , createRouter = require('express').Router

module.exports = function() {
  var router = createRouter()
  router.route('/:userId')
    .get(checkPermissions(['editPermissions']), getPermissions)
    .post(checkPermissions(['editPermissions']), updatePermissions)

  return router
}

function getPermissions(req, res, next) {
  var userId = req.params.userId

  permissions.get(userId, function(err, permissions) {
    if (err) {
      req.log.error({ err: err }, 'error querying permissions')
      next(err)
    } else if (!permissions) {
      req.log.error({ err: err }, 'permissions object empty')
      next(err)
    } else {
      res.send(permissions)
    }
  })
}

function updatePermissions(req, res, next) {
  var userId = req.params.userId
    , perms = { editPermissions: req.body.editPermissions
              , debug: req.body.debug
              , acceptInvites: req.body.acceptInvites
              }

  permissions.update(userId, perms, function(err, permissions) {
    if (err) {
      req.log.error({ err: err }, 'error updating permissions')
      next(err)
    }

    res.send(permissions)
  })
}
