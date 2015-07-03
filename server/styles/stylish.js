import stylish from 'koa-stylish'
import autoprefixer from 'autoprefixer-stylus'
import path from 'path'
import isDev from '../env/is-dev'

export default function() {
  let styleSrc = path.normalize(path.join(__dirname, '..', '..', 'styles'))

  function setup(renderer) {
    return renderer.use(autoprefixer({ browsers: ['last 2 version'] }))
  }

  let options = {
    src: styleSrc,
    setup: setup
  }
  if (!isDev) {
    options.compress = true
    options.cache = true
  }

  return stylish(options)
}
