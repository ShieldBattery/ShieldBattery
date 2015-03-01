require('babel/register')({
  // disable all the things iojs supports natively
  blacklist: [
    'es6.blockScoping',
    'es6.constants',
    'es6.templateLiterals',
    'regenerator',
  ],
  loose: 'all',
})

require('./app.js')
