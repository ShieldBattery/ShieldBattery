// Meant to run in a child-process, creates a local rally-point server for use during development

require('../../../babel-register-hook')
require('core-js/stable')
require('regenerator-runtime/runtime')
require('./local-server.js')
