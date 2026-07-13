// Exposes the local dev server via Tailscale Funnel while the dev stack runs,
// so a remote (e.g. staging) rally-point2 coordinator can deliver its game-event
// webhooks to this machine. Runs the funnel in the FOREGROUND deliberately: the
// exposure lives exactly as long as this process, so closing the dev stack
// closes the tunnel.
//
// Only engages when .env points SB_RP2_COORDINATOR_URL at a non-loopback
// coordinator — loopback dev needs no tunnel, and a dev server should never
// become publicly reachable as a side effect of starting the stack without
// having configured a remote coordinator first. Exits quietly (successfully)
// in every not-applicable case, so the run-pty pane is inert for everyone else.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

// The dev server's HTTP port (webpack proxies through it; the webhook route is
// served here).
const PORT = '5555'

let envFile = ''
try {
  envFile = readFileSync('.env', 'utf8')
} catch {
  // No .env at all — certainly no remote coordinator.
}
const match = envFile.match(/^\s*SB_RP2_COORDINATOR_URL\s*=\s*(\S+)/m)
const url = match?.[1]?.replace(/^['"]|['"]$/g, '')

if (!url || /127\.0\.0\.1|localhost|\[::1\]/.test(url)) {
  console.log(
    'No remote coordinator in .env (SB_RP2_COORDINATOR_URL) — webhook funnel not needed.',
  )
  process.exit(0)
}

console.log(`Remote coordinator configured (${url}).`)
console.log(`Exposing http://localhost:${PORT} via Tailscale Funnel for its webhooks…`)
const child = spawn('tailscale', ['funnel', PORT], { stdio: 'inherit' })
child.on('error', () => {
  console.log(
    'tailscale was not found on PATH — skipping the funnel. Webhooks from the remote ' +
      'coordinator will not reach this dev server (games still work; you lose mid-game ' +
      'departure/desync notices).',
  )
  process.exit(0)
})
child.on('exit', code => process.exit(code ?? 0))
