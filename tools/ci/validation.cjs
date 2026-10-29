const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const VERSION = 1
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const JOBS = {
  js: ['unit-tests', 'integration-tests'],
  game: ['clippy', 'fmt', 'licenses', 'test'],
  'server-rs': ['clippy', 'fmt', 'test', 'typeshare', 'sqlx-prepare'],
}
const sha = value => /^[a-f0-9]{40}$/.test(value ?? '')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

function documentation({ mode, type, file }) {
  return (
    mode === '100644' && type === 'blob' && (file === 'README.md' || /^docs\/.+\.md$/.test(file))
  )
}

function relevant(component, file) {
  if (component === 'js') return true
  // Root configuration and shared CI can affect either Rust workspace or its generated files.
  if (!file.includes('/') || /^(\.github|\.cargo|tools\/ci)\//.test(file)) return true
  if (component === 'game') {
    return file.startsWith('game/') || file === 'tools/SB_INIT_BINARY_LICENSE.txt'
  }
  return /^(server-rs|migrations|deployment)\//.test(file) || file === 'common/typeshare.ts'
}

function fingerprint(ref, component) {
  if (!sha(ref)) throw new Error('Expected immutable commit SHA')
  const tree = execFileSync('git', ['ls-tree', '-rz', '--full-tree', ref], {
    maxBuffer: 16 * 1024 * 1024,
  })
  const hash = createHash('sha256').update(`ci-validation-${VERSION}\0`)
  for (const entry of tree.toString('utf8').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t')
    const [mode, type] = entry.slice(0, tab).split(' ')
    const file = entry.slice(tab + 1)
    if (documentation({ mode, type, file })) continue
    if (!component || relevant(component, file)) hash.update(entry + '\0')
  }
  return hash.digest('hex')
}

function checkoutContext(env, event) {
  const component = env.CI_COMPONENT
  if (!JOBS[component]) throw new Error('Unknown CI component')
  const checkoutSha = git('rev-parse', 'HEAD')
  if (checkoutSha !== env.GITHUB_SHA) throw new Error('Unexpected checkout')
  const pr = env.GITHUB_EVENT_NAME === 'pull_request' ? event.pull_request : undefined
  const headSha = pr?.head.sha ?? checkoutSha
  if (!sha(headSha) || (pr && !sha(pr.base.sha))) throw new Error('Invalid revision')
  if (pr) {
    const parents = git('show', '-s', '--format=%P', checkoutSha).split(' ')
    if (parents[0] !== pr.base.sha || parents[1] !== headSha) {
      throw new Error('PR checkout does not match event merge parents')
    }
  }
  return {
    version: VERSION,
    component,
    workflow: env.CI_WORKFLOW_FILE,
    repository: env.GITHUB_REPOSITORY,
    event: env.GITHUB_EVENT_NAME,
    branch: pr?.head.ref ?? env.GITHUB_REF,
    headRepository: pr?.head.repo.full_name ?? env.GITHUB_REPOSITORY,
    pullRequest: pr?.number ?? null,
    baseSha: pr?.base.sha ?? null,
    baseRef: pr?.base.ref ?? null,
    headSha,
    checkoutSha,
    fingerprint: fingerprint(checkoutSha),
    headFingerprint: fingerprint(headSha),
  }
}

function latestCandidate(runs, context, runId) {
  return runs
    .filter(
      run =>
        String(run.id) !== String(runId) &&
        ['push', 'pull_request', 'workflow_dispatch'].includes(run.event) &&
        run.headBranch === context.branch.replace(/^refs\/heads\//, '') &&
        run.headRepository === context.headRepository,
    )
    .sort(
      (a, b) =>
        Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt) ||
        b.id - a.id,
    )[0]
}

function eligible(run, now) {
  const age = now - Date.parse(run?.createdAt)
  return (
    run?.status === 'completed' &&
    run.conclusion === 'success' &&
    sha(run.headSha) &&
    age >= 0 &&
    age <= MAX_AGE_MS
  )
}

function matchesReceipt(receipt, context, candidate, candidateHeadFingerprint, now = Date.now()) {
  return (
    now - Date.parse(receipt.validatedAt) >= 0 &&
    now - Date.parse(receipt.validatedAt) <= MAX_AGE_MS &&
    receipt.version === VERSION &&
    String(receipt.runId) === String(candidate.id) &&
    /^\d+$/.test(String(receipt.validatedRunId)) &&
    receipt.headSha === candidate.headSha &&
    candidateHeadFingerprint === context.headFingerprint &&
    [
      'component',
      'workflow',
      'repository',
      'event',
      'branch',
      'headRepository',
      'pullRequest',
      'baseSha',
      'baseRef',
      'fingerprint',
      'headFingerprint',
    ].every(key => receipt[key] === context[key])
  )
}

function resultIsValid(needs, component) {
  const plan = needs.plan
  if (plan?.result !== 'success') return false
  const run = plan.outputs.run
  if (run !== 'true' && run !== 'false') return false
  if (run === 'true' && plan.outputs.mode !== 'full') return false
  if (run === 'false' && !['unaffected', 'reuse'].includes(plan.outputs.mode)) return false
  return JOBS[component].every(
    job => needs[job]?.result === (run === 'true' ? 'success' : 'skipped'),
  )
}

async function api(endpoint, query = {}) {
  const url = new URL(
    `${process.env.GITHUB_API_URL}/repos/${process.env.GITHUB_REPOSITORY}/${endpoint}`,
  )
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('CI evidence API unavailable')
  return response.json()
}

function output(values) {
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(String(value))) throw new Error('Invalid output')
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
}

function directories() {
  const directory = path.join(process.env.RUNNER_TEMP, 'ci-validation-receipt')
  return {
    directory,
    receipt: path.join(directory, 'receipt.json'),
    state: path.join(process.env.RUNNER_TEMP, 'ci-validation-state.json'),
  }
}

async function prepare() {
  const env = process.env
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const context = checkoutContext(env, event)
  const files = directories()
  fs.rmSync(files.directory, { recursive: true, force: true })
  const state = { context, mode: 'full', reason: 'No reusable successful validation' }
  const forced = env.GITHUB_EVENT_NAME === 'workflow_dispatch' || Number(env.GITHUB_RUN_ATTEMPT) > 1
  if (forced) {
    state.reason = 'Manual dispatch or rerun requests full validation'
  } else if (
    context.baseSha &&
    fingerprint(context.checkoutSha, context.component) ===
      fingerprint(context.baseSha, context.component)
  ) {
    state.mode = 'unaffected'
    state.reason = 'No component build inputs changed relative to PR base'
  } else if (['push', 'pull_request'].includes(context.event)) {
    try {
      const response = await api(`actions/workflows/${context.workflow}/runs`, {
        branch: context.branch.replace(/^refs\/heads\//, ''),
        ['per_page']: 30,
      })
      const runs = response.workflow_runs.map(run => ({
        id: run.id,
        event: run.event,
        headBranch: run.head_branch,
        headRepository: run.head_repository?.full_name,
        headSha: run.head_sha,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        status: run.status,
        conclusion: run.conclusion,
      }))
      const candidate = latestCandidate(runs, context, env.GITHUB_RUN_ID)
      // A failed, cancelled, running, or missing latest run never falls back to an older success.
      if (eligible(candidate, Date.now()) && candidate.event === context.event) {
        const comparison = await api(`compare/${candidate.headSha}...${context.headSha}`)
        if (['ahead', 'identical'].includes(comparison.status)) {
          if (git('rev-parse', '--is-shallow-repository') === 'true') {
            // Only commit/tree metadata is needed; no history walk or changed-file API truncation.
            execFileSync(
              'git',
              [
                'fetch',
                '--no-tags',
                '--filter=blob:none',
                '--depth=1',
                'origin',
                candidate.headSha,
              ],
              { stdio: 'pipe', timeout: 30000 },
            )
          }
          state.candidateHeadFingerprint = fingerprint(candidate.headSha)
          state.candidate = { id: candidate.id, headSha: candidate.headSha }
        }
      }
    } catch {
      state.reason = 'Prior validation could not be verified; running full checks'
    }
  }
  fs.writeFileSync(files.state, JSON.stringify(state))
  output({ 'candidate-run-id': state.candidate?.id ?? '' })
}

function decide() {
  const files = directories()
  const state = JSON.parse(fs.readFileSync(files.state, 'utf8'))
  let validatedRunId = ''
  let validatedAt = ''
  if (state.candidate) {
    try {
      const receipt = JSON.parse(fs.readFileSync(files.receipt, 'utf8'))
      if (matchesReceipt(receipt, state.context, state.candidate, state.candidateHeadFingerprint)) {
        state.mode = 'reuse'
        state.reason = 'Recent successful validation has identical code, CI inputs, and PR base'
        validatedRunId = receipt.validatedRunId
        validatedAt = receipt.validatedAt
      }
    } catch {
      // Missing, expired, malformed, or inaccessible evidence requires real checks.
    }
  }
  output({
    run: state.mode === 'full',
    mode: state.mode,
    'validated-run-id': validatedRunId,
    'validated-at': validatedAt,
  })
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### ${state.context.component} CI\n\n${state.mode}: ${state.reason}.\n${validatedRunId ? `\nOriginal validation run: ${validatedRunId}.\n` : ''}`,
  )
}

function finish() {
  const needs = JSON.parse(process.env.CI_JOB_RESULTS)
  const component = process.env.CI_COMPONENT
  if (!JOBS[component] || !resultIsValid(needs, component)) {
    throw new Error('CI planning or a required validation job did not succeed')
  }
  if (needs.plan.outputs.mode === 'unaffected') {
    output({ save: false })
    return
  }
  const context = checkoutContext(
    process.env,
    JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
  )
  const validatedRunId =
    needs.plan.outputs.run === 'true'
      ? process.env.GITHUB_RUN_ID
      : needs.plan.outputs['validated-run-id']
  if (!/^\d+$/.test(validatedRunId)) throw new Error('Missing successful validation origin')
  const validatedAt =
    needs.plan.outputs.run === 'true'
      ? new Date().toISOString()
      : needs.plan.outputs['validated-at']
  const age = Date.now() - Date.parse(validatedAt)
  if (!(age >= 0 && age <= MAX_AGE_MS)) {
    throw new Error('Validation receipt expired; rerun all jobs for fresh validation')
  }
  const files = directories()
  fs.mkdirSync(files.directory, { recursive: true })
  fs.writeFileSync(
    files.receipt,
    JSON.stringify(
      { ...context, runId: process.env.GITHUB_RUN_ID, validatedRunId, validatedAt },
      null,
      2,
    ),
  )
  output({ save: true })
}

module.exports = {
  documentation,
  relevant,
  fingerprint,
  checkoutContext,
  latestCandidate,
  eligible,
  matchesReceipt,
  resultIsValid,
}
if (require.main === module) {
  const action = { prepare, decide, finish }[process.argv[2]]
  if (!action) throw new Error('Expected prepare, decide, or finish')
  Promise.resolve()
    .then(action)
    .catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
}
