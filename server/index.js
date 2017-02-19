process.env.BABEL_ENV = 'node'

require('babel-register')
require('babel-polyfill')
require('./app.js')
