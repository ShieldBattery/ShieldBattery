process.env.BABEL_ENV = 'app'

require('babel-register')
require('babel-polyfill')
require('./app.js')
