process.env.BABEL_ENV = 'node'

require('../babel-register-hook')
require('@babel/polyfill')
require('./app.js')
