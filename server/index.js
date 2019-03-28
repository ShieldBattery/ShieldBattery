process.env.BABEL_ENV = 'node'

require('../babel-register-hook')
require('core-js/stable')
require('regenerator-runtime/runtime')
require('./app.js')
