// Meant to run in a child-process, creates a local rally-point server for use during development

require('../../../babel-register-hook')
require('@babel/polyfill')
require('./local-server.js')
