const dotenv = require('dotenv')
const dotenvExpand = require('dotenv-expand')
dotenvExpand.expand(dotenv.config({ quiet: true }))

process.env.BABEL_ENV = 'node'
require('../babel-register')
require('./app')
