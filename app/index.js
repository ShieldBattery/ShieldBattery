require('@babel/register')({
  presets: [
    [
      '@babel/preset-env',
      {
        targets: { electron: '21.1' },
        useBuiltIns: 'usage',
        corejs: 3,
      },
    ],
    ['@babel/preset-typescript'],
  ],

  plugins: [
    'babel-plugin-transform-typescript-metadata',
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    ['babel-plugin-const-enum'],
  ],

  extensions: ['.es6', '.es', '.jsx', '.js', '.mjs', '.ts', '.tsx'],
})

global.IS_ELECTRON = true

require('./startup')
