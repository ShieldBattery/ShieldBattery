// Prompts for the smart card PIN, then runs the given command with SB_CSC_PIN set so the
// sign hook (smartcard-sign.cjs) never has to prompt mid-build. The hook can prompt on its
// own, but electron-builder's progress renderer redraws the terminal right over the prompt
// (and echo is suppressed), so a mid-build prompt looks like a hung build. Collecting the
// PIN before electron-builder starts sidesteps that entirely.
//
// Usage: node tools/codesign/with-pin.cjs <command> [args...]
//
// An already-set SB_CSC_PIN is respected (no prompt), so CI or a manual
// `$env:SB_CSC_PIN = Read-Host 'PIN'` still works unchanged.
'use strict'

const { spawn } = require('child_process')
const fs = require('fs')
const readline = require('readline')

// pnpm's shell emulator pipes the script's stderr and forwards it line-by-line, so a
// prompt without a trailing newline never shows up at all. Prefer the real console
// device when stderr is a pipe, and always end the prompt line with a newline.
function promptStream() {
  if (process.stderr.isTTY) {
    return process.stderr
  }
  try {
    const device = process.platform === 'win32' ? '\\\\.\\CONOUT$' : '/dev/tty'
    return fs.createWriteStream(device)
  } catch {
    return process.stderr
  }
}

function promptPin() {
  if (process.env.SB_CSC_PIN) {
    return Promise.resolve(process.env.SB_CSC_PIN)
  }
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new Error(
        'No terminal available to prompt for the smart card PIN. ' +
          'Set the SB_CSC_PIN environment variable and re-run the build.',
      ),
    )
  }
  return new Promise(resolve => {
    const out = promptStream()
    const rl = readline.createInterface({
      input: process.stdin,
      output: out,
      terminal: true,
    })
    out.write('\nYubiKey PIN (used to sign all files in this build) — typing is hidden, press Enter to submit:\n')
    // Suppress echo so the PIN never appears on screen.
    rl._writeToOutput = () => {}
    rl.question('', pin => {
      rl.close()
      out.write('PIN received.\n')
      resolve(pin.trim())
    })
  })
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command) {
    throw new Error('Usage: node tools/codesign/with-pin.cjs <command> [args...]')
  }

  const pin = await promptPin()
  if (!pin) {
    throw new Error('Empty PIN — aborting before signing can fail on every file.')
  }

  // shell: true both resolves .cmd shims (node >= 21 refuses to spawn them directly) and
  // keeps stdio wired straight through to this terminal.
  const child = spawn([command, ...args].join(' '), {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, SB_CSC_PIN: pin },
  })
  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 1))
  })
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
