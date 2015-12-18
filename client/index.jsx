import '../styles/site.styl'

import React from 'react'
import { render } from 'react-dom'
import App from './app.jsx'

// initialize socket
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
}).then(elem => render(<App/>, elem))
