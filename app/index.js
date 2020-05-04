process.env.BABEL_ENV = 'app'

require('@babel/register')({
  env: {
    app: {
      presets: [
        [
          '@babel/preset-env',
          {
            targets: { electron: '7.1' },
          },
        ],
      ],
    },
    node: {
      presets: [
        [
          '@babel/preset-env',
          {
            targets: { node: 'current' },
          },
        ],
      ],
    },
  },

  plugins: [
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    ['@babel/plugin-proposal-class-properties', { loose: true }],
    ['@babel/plugin-proposal-function-bind'],
  ],
})
require('core-js/stable')
require('regenerator-runtime/runtime')

const path = require('path')
const isDev = require('electron-is-dev')
const app = require('electron').app
const getUserDataPath = require('./user-data-path').getUserDataPath
const ensureSingleInstance = require('./single-instance').default

// Set a proper app name, since our build setup makes the one in our package.json innaccurate
app.name = path.basename(getUserDataPath())

// Ensure that it's only possible to open a single instance of the application in non-dev mode. If
// someone tries to open two instances, we just focus the main window
if (!isDev) {
  ensureSingleInstance()
} else {
  require('./app.js')
}
