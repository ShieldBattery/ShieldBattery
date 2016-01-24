import log from './logger'
import bw from './natives/bw'
import forge from './natives/forge'
import './natives/snp'

forge.on('startWndProc', () => log.verbose('forge\'s wndproc pump started'))
  .on('endWndProc', () => log.verbose('forge\'s wndproc pump finished'))

export default async function initGame({ lobby, settings, setup, localUser }) {
  bw.setSettings(settings)

  if (!forge.inject()) {
    throw new Error('forge injection failed')
  }
  log.verbose('forge injected')

  await bw.initProcess()
  log.verbose('process initialized')
  forge.runWndProc()
}
