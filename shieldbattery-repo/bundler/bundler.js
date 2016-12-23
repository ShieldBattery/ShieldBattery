import rimraf from 'rimraf'
import path from 'path'
import fs from 'fs'
import through from 'through2'
import crypto from 'crypto'
import webpack from 'webpack'
import webpackConfig from './webpack.config'

const bundleDir = path.join(__dirname, 'bundle')
const bundleJsDir = path.join(bundleDir, 'js')

const hashes = {}
const sizes = {}
function createPassthroughHasher(file) {
  // sanitize file paths to always use '/' as the separator
  file = file.split(path.sep).join('/')

  const sha = crypto.createHash('sha256')
  let size = 0

  return through(function(chunk, enc, cb) {
    sha.update(chunk)
    this.push(chunk)
    size += chunk.length
    cb()
  }, function(cb) {
    hashes[file] = sha.digest('hex')
    sizes[file] = size
    cb()
  })
}

const binaries = [
    ['../Release/psi.exe', path.join(bundleDir, 'psi.exe')],
    ['../Release/psi-emitter.exe', path.join(bundleDir, 'psi-emitter.exe')],
    ['../Release/shieldbattery.dll', path.join(bundleDir, 'shieldbattery.dll')],
]

function checkPrereqs() {
  console.log('Checking prerequisites...')
  binaries.forEach(function(prereq) {
    try {
      require.resolve(prereq[0])
    } catch (err) {
      console.log('Error resolving prerequisite: ' + prereq[0])
      console.log('Please run vcbuild.bat before bundling')
      throw err
    }
  })

  console.log('Done!\n')
  removePrevious()
}

function removePrevious() {
  console.log('Removing previous bundle...')
  rimraf(bundleDir, function(err) {
    if (err) throw err

    console.log('Done!\n')
    console.log('Creating bundle directory...')
    fs.mkdir(bundleDir, dirCreated)
  })
}

function dirCreated(err) {
  if (err) throw err

  console.log('Done!\n')
  console.log('Creating js directory...')
  fs.mkdir(bundleJsDir, jsDirCreated)
}

function jsDirCreated(err) {
  if (err) throw err

  console.log('Done!\n')
  console.log('Bundling JS...')

  const compiler = webpack(webpackConfig)
  compiler.run((err, stats) => {
    if (err) {
      throw err
    }
    console.log(stats.toString())

    const read = fs.createReadStream(path.join(bundleJsDir, 'index.js'))
    read.pipe(createPassthroughHasher('js/index.js'))
      .on('data', () => {})
      .on('end', () => {
        console.log('JS bundle written!')
        console.log('Done!\n')
        copyBinaries()
      })
  })
}


function copyBinaries() {
  console.log('Copying binaries...')

  const copying = Object.create(null)
  binaries.forEach(function(binary) {
    const input = binary[0]
    const output = binary[1]

    fs.createReadStream(input)
      .pipe(createPassthroughHasher(path.relative(bundleDir, binary[1])))
      .pipe(fs.createWriteStream(output))
      .on('finish', function() {
        console.log(input + ' => ' + output)
        delete copying[input]
        maybeDone()
      })
    copying[input] = true
  })

  function maybeDone() {
    if (Object.keys(copying).length) return

    console.log('Done!\n')
    writeManifest()
  }
}

function writeManifest() {
  console.log('Writing update manifest...')

  const manifestObj = Object.keys(hashes).reduce(function(prev, cur) {
    prev[cur] = {
      sha: hashes[cur],
      size: sizes[cur]
    }
    return prev
  }, {})

  fs.writeFile(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifestObj), function(err) {
    if (err) {
      console.log('Error writing manifest:', err)
      return
    }

    console.log('Done!\n')
  })
}

checkPrereqs()
