// Since our project structure doesn't play well with the new, and annoying, babel 7 philosophy,
// we must do these shenanigans to make everything work again. Note: this file is only necessary
// in non-root folders that have a package.json in it (eg. app, server)

require('@babel/register')({
  // Babel won't by default look for the `babel.config.js` outside the "working directory" anymore
  // (which is the one with the package.json file in it), so we explicitly tell it to look upwards.
  rootMode: 'upward',
  // This is necessary to make babel compile stuff outside the "working directory".
  // See this issue for more info: https://github.com/babel/babel/issues/8321
  ignore: [/node_modules/],
})
