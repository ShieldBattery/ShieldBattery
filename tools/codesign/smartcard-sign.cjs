// electron-builder Windows sign hook that runs signtool through MGTEK's scsigntool
// (https://www.mgtek.com/smartcard) so the smart card PIN is supplied programmatically.
//
// Our code-signing key lives on a YubiKey (a smart card). signtool has no command-line
// option to provide a smart card PIN, so every signtool process pops an interactive PIN
// dialog — and electron-builder spawns one signtool process per signed file, which means
// a PIN prompt for the app exe, every DLL, the uninstaller, the installer, etc.
// scsigntool wraps signtool and injects the PIN via the smart card API, letting each
// per-file process authenticate silently. The PIN is asked for once per build via a
// hidden terminal prompt, or taken from SB_CSC_PIN if set.
//
// Requirements:
// - MGTEK Smartcard Tools installed (scsigntool on PATH, in its default install
//   location, or pointed at via SCSIGNTOOL_PATH).
// - The card key's PIN cache policy must allow per-process caching. For YubiKey PIV
//   that means the key must NOT be in slot 9c, whose PIN policy is hardwired to
//   "always prompt"; our cert lives in slot 9a (PIN policy "once"), which works.
'use strict'

const { execFile } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')
const readline = require('readline')

const SCSIGNTOOL_CANDIDATES = [
  process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, 'Programs', 'MGTEK Smartcard Tools', 'ScSignTool.exe'),
  'C:\\Program Files (x86)\\MGTEK\\Smartcard Tools\\ScSignTool.exe',
  'C:\\Program Files\\MGTEK\\Smartcard Tools\\ScSignTool.exe',
].filter(Boolean)

const RETRYABLE_ERRORS = [
  'The specified timestamp server either could not be reached',
  'The file is being used by another process',
]

function findScsigntool() {
  if (process.env.SCSIGNTOOL_PATH) {
    return process.env.SCSIGNTOOL_PATH
  }
  for (const candidate of SCSIGNTOOL_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  // Fall back to PATH lookup; if it's not there either, the spawn fails with ENOENT and
  // we show an actionable error.
  return 'scsigntool.exe'
}

let pinPromise
function getPin() {
  if (!pinPromise) {
    if (process.env.SB_CSC_PIN) {
      pinPromise = Promise.resolve(process.env.SB_CSC_PIN)
    } else if (!process.stdin.isTTY) {
      pinPromise = Promise.reject(
        new Error(
          'No terminal available to prompt for the smart card PIN. ' +
            'Set the SB_CSC_PIN environment variable and re-run the build.',
        ),
      )
    } else {
      pinPromise = new Promise(resolve => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stderr,
          terminal: true,
        })
        process.stderr.write('\nYubiKey PIN (used to sign all files in this build): ')
        // Suppress echo so the PIN never appears on screen.
        rl._writeToOutput = () => {}
        rl.question('', pin => {
          rl.close()
          process.stderr.write('\n')
          resolve(pin.trim())
        })
      })
    }
  }
  return pinPromise
}

function scrubPin(text, pin) {
  return String(text).split(pin).join('<pin>')
}

function runScsigntool(tool, args, env, pin) {
  const timeout = parseInt(process.env.SIGNTOOL_TIMEOUT, 10) || 10 * 60 * 1000
  return new Promise((resolve, reject) => {
    execFile(tool, args, { env, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              `Could not find scsigntool (tried "${tool}"). Install MGTEK Smartcard Tools ` +
                'from https://www.mgtek.com/smartcard or set SCSIGNTOOL_PATH to the exe.',
            ),
          )
        } else {
          // The command line contains the PIN, so scrub it before surfacing anything.
          reject(new Error(scrubPin(`signing failed: ${err.message}\n${stdout}\n${stderr}`, pin)))
        }
      } else {
        resolve()
      }
    })
  })
}

exports.default = async function sign(configuration, packager) {
  if (process.platform !== 'win32') {
    throw new Error('This sign hook only supports signing on Windows')
  }

  // computeSignToolArgs yields the same argument list electron-builder would pass to
  // signtool itself (cert selection by thumbprint/store, hash, timestamping, etc.);
  // scsigntool accepts signtool's arguments verbatim after its own -pin option.
  const args = configuration.computeSignToolArgs(true)
  const pin = await getPin()

  const signingManager = await packager.signingManager.value
  const toolInfo = await signingManager.getToolPath()
  const env = { ...process.env, ...(toolInfo.env || {}) }
  // scsigntool locates signtool.exe via PATH, so point it at the same signtool build
  // electron-builder would have run directly. The spread above made env a plain object,
  // so match the existing PATH key's casing (usually "Path" on Windows) rather than
  // creating a duplicate key.
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH'
  env[pathKey] = `${path.dirname(toolInfo.path)}${path.delimiter}${env[pathKey] || ''}`

  const tool = findScsigntool()
  for (let attempt = 0; ; attempt++) {
    try {
      await runScsigntool(tool, ['-pin', pin, ...args], env, pin)
      return
    } catch (err) {
      // Timestamp servers flake regularly; retry like electron-builder's built-in
      // signing does before giving up.
      if (attempt < 2 && RETRYABLE_ERRORS.some(m => err.message.includes(m))) {
        await new Promise(r => setTimeout(r, 15000))
        continue
      }
      throw err
    }
  }
}
