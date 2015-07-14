import '../styles/site.styl'

import React from 'react'
import Router from 'react-router'
import routes from './routes.jsx'

// initialize sockets
import './network/site-socket'
import './network/psi-socket'

new Promise((resolve, reject) => {
  const elem = document.getElementById('app')
  if (elem) return resolve(elem)

  document.addEventListener('DOMContentLoaded', e => {
    const elem = document.getElementById('app')
    if (elem) {
      resolve(elem)
    } else {
      reject(new Error('app element could not be found'))
    }
  })
}).then(elem => {
  Router.run(routes, Router.HistoryLocation,
      Handler => React.render(<Handler />, elem))
})
