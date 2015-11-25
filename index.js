require('babel/register')({
  // disable all the things iojs supports natively
  blacklist: [
    'es6.blockScoping',
    'es6.constants',
    'es6.templateLiterals',
  ],
  loose: 'all',
  stage: 0,
})

require('./app.js')
