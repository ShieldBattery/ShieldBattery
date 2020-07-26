require('dotenv').config()

process.env.BABEL_ENV = 'node'
require('@babel/register')
require('./app.js')
