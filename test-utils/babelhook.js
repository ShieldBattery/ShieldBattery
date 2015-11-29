// TODO(tec27): utilize a babelrc instead (and move back to using the mocha compilers option)
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
