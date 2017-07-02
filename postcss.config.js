module.exports = function(ctx) {
  const cssNextOpts =
    ctx.options.target === 'electron-renderer'
      ? { browsers: 'last 2 Chrome versions' }
      : { browsers: 'last 2 versions' }
  return {
    plugins: [
      require('postcss-for'),
      require('postcss-mixins'),
      require('postcss-cssnext')(cssNextOpts),
    ],
  }
}
