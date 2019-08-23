// Meant to run in a child-process, creates a local rally-point server for use during development

require('@babel/register')({
  // This is necessary to make babel compile stuff outside the "working directory".
  // See this issue for more info: https://github.com/babel/babel/issues/8321
  ignore: [/node_modules/],
})
require('core-js/stable')
require('regenerator-runtime/runtime')
require('./local-server.js')
