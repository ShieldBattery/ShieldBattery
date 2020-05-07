process.env.BABEL_ENV = 'node'

require('dotenv').config()

require('@babel/register')({
  // This is necessary to make babel compile stuff outside the "working directory".
  // See this issue for more info: https://github.com/babel/babel/issues/8321
  ignore: [/node_modules/],
})
require('./app.js')
