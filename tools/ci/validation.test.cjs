const assert = require('node:assert/strict')
const { execFile, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { promisify } = require('node:util')
const policy = require('./validation.cjs')

const script = path.join(__dirname, 'validation.cjs')
const now = Date.now()
const a = 'a'.repeat(40)
const b = 'b'.repeat(40)
const context = {
  version: 1,
  component: 'js',
  workflow: 'js-ci.yml',
  repository: 'ShieldBattery/ShieldBattery',
  event: 'pull_request',
  branch: 'feature',
  headRepository: 'ShieldBattery/fork',
  pullRequest: 12,
  baseSha: b,
  baseRef: 'master',
  headSha: a,
  fingerprint: 'merged',
  headFingerprint: 'head',
}
const candidate = {
  id: 10,
  headSha: a,
  headBranch: 'feature',
  event: 'pull_request',
  headRepository: 'ShieldBattery/fork',
  createdAt: new Date(now - 1000).toISOString(),
  status: 'completed',
  conclusion: 'success',
}
const receipt = {
  ...context,
  runId: 10,
  validatedRunId: '9',
  validatedAt: new Date(now - 1000).toISOString(),
}

function needs(run, mode = run === 'true' ? 'full' : 'reuse') {
  return {
    plan: {
      result: 'success',
      outputs: { run, mode, 'validated-run-id': '9', 'validated-at': receipt.validatedAt },
    },
    'unit-tests': { result: run === 'true' ? 'success' : 'skipped' },
    'integration-tests': { result: run === 'true' ? 'success' : 'skipped' },
  }
}

test('only ordinary root README and Markdown under docs are non-build inputs', () => {
  const entry = file => ({ mode: '100644', type: 'blob', file })
  for (const file of ['README.md', 'docs/check.md', 'docs/nested/check.md'])
    assert.ok(policy.documentation(entry(file)))
  for (const file of [
    'game/README.md',
    'LICENSE',
    'docs/check.js',
    'docs/read.MD',
    '.github/workflows/README.md',
  ])
    assert.equal(policy.documentation(entry(file)), false)
  assert.equal(policy.documentation({ ...entry('docs/link.md'), mode: '120000' }), false)
  assert.equal(policy.documentation({ ...entry('docs/executable.md'), mode: '100755' }), false)
})

test('Rust scopes include shared build configuration and generated-file dependencies', () => {
  for (const component of ['game', 'server-rs']) {
    for (const file of [
      'LICENSE',
      '.gitattributes',
      '.cargo/config.toml',
      'rust-toolchain.toml',
      '.github/workflows/ci-plan.yml',
      'tools/ci/validation.cjs',
    ])
      assert.ok(policy.relevant(component, file))
    assert.equal(policy.relevant(component, 'client/view.tsx'), false)
  }
  for (const file of [
    'server-rs/Cargo.lock',
    'common/typeshare.ts',
    'migrations/schema.sql',
    'deployment/appserver/db/init.sh',
    'pnpm-lock.yaml',
    '.oxfmtrc.json',
  ])
    assert.ok(policy.relevant('server-rs', file))
  assert.ok(policy.relevant('game', 'tools/SB_INIT_BINARY_LICENSE.txt'))
})

test('latest matching run wins even when it failed or has no PR association array', () => {
  const failed = { ...candidate, id: 11, conclusion: 'failure', ['pull_requests']: [] }
  assert.equal(
    policy.latestCandidate(
      [candidate, failed, { ...candidate, id: 12, headRepository: 'another/fork' }],
      context,
      99,
    ).id,
    11,
  )
  assert.equal(policy.latestCandidate([candidate], context, 10), undefined)
})

for (const [name, change] of Object.entries({
  failure: { conclusion: 'failure' },
  cancelled: { conclusion: 'cancelled' },
  running: { status: 'in_progress' },
  stale: { createdAt: new Date(now - 25 * 3600000).toISOString() },
  future: { createdAt: new Date(now + 1000).toISOString() },
  invalidSha: { headSha: 'branch' },
})) {
  test(`no proof from ${name} run`, () =>
    assert.equal(policy.eligible({ ...candidate, ...change }, now), false))
}

test('receipt pins code, base, workflow, repository, PR and original validation age', () => {
  assert.ok(policy.matchesReceipt(receipt, context, candidate, 'head', now))
  for (const key of [
    'version',
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
    'headSha',
    'runId',
  ])
    assert.equal(
      policy.matchesReceipt({ ...receipt, [key]: 'different' }, context, candidate, 'head', now),
      false,
      key,
    )
  assert.equal(policy.matchesReceipt(receipt, context, candidate, 'forged-head', now), false)
  assert.equal(
    policy.matchesReceipt(
      { ...receipt, validatedAt: new Date(now - 25 * 3600000).toISOString() },
      context,
      candidate,
      'head',
      now,
    ),
    false,
  )
  assert.equal(
    policy.matchesReceipt({ ...receipt, validatedAt: 'invalid' }, context, candidate, 'head', now),
    false,
  )
})

test('guard accepts only intentional skips or every successful required job', () => {
  assert.ok(policy.resultIsValid(needs('true'), 'js'))
  assert.ok(policy.resultIsValid(needs('false'), 'js'))
  for (const result of ['failure', 'cancelled', 'skipped']) {
    const results = needs('true')
    results['integration-tests'].result = result
    assert.equal(policy.resultIsValid(results, 'js'), false)
  }
  const broken = needs('false')
  broken.plan.result = 'failure'
  assert.equal(policy.resultIsValid(broken, 'js'), false)
  assert.equal(policy.resultIsValid(needs('false', 'unknown'), 'js'), false)
  const missing = needs('true')
  delete missing['integration-tests']
  assert.equal(policy.resultIsValid(missing, 'js'), false)
})

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ci-policy-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const repo = path.join(directory, 'repo')
  fs.mkdirSync(repo)
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git('init', '-q')
  git('config', 'user.name', 'ShieldBattery')
  git('config', 'user.email', 'ci@example.invalid')
  const commit = files => {
    for (const [file, data] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
      fs.writeFileSync(path.join(repo, file), data)
    }
    git('add', '.')
    git('commit', '-qm', 'Update fixture.')
    return git('rev-parse', 'HEAD')
  }
  const base = commit({ 'client/code.ts': 'base', 'game/lib.rs': 'base', 'docs/check.md': 'base' })
  const head = commit({ 'client/code.ts': 'feature' })
  const merge = git('commit-tree', `${head}^{tree}`, '-p', base, '-p', head, '-m', 'Merge fixture.')
  const docs = commit({ 'docs/check.md': 'report' })
  const mergeDocs = git(
    'commit-tree',
    `${docs}^{tree}`,
    '-p',
    base,
    '-p',
    docs,
    '-m',
    'Merge report.',
  )
  git('checkout', '-q', '--detach', mergeDocs)
  const eventPath = path.join(directory, 'event.json')
  const event = {
    ['pull_request']: {
      number: 12,
      head: { sha: docs, ref: 'feature', repo: { ['full_name']: 'ShieldBattery/fork' } },
      base: { sha: base, ref: 'master' },
    },
  }
  fs.writeFileSync(eventPath, JSON.stringify(event))
  const env = {
    ...process.env,
    CI_COMPONENT: 'js',
    CI_WORKFLOW_FILE: 'js-ci.yml',
    GITHUB_SHA: mergeDocs,
    GITHUB_REPOSITORY: context.repository,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF: 'refs/pull/12/merge',
    GITHUB_RUN_ID: '20',
    GITHUB_RUN_ATTEMPT: '1',
    GH_TOKEN: '',
    GITHUB_EVENT_PATH: eventPath,
    RUNNER_TEMP: directory,
    GITHUB_STEP_SUMMARY: path.join(directory, 'summary'),
    GITHUB_OUTPUT: path.join(directory, 'output'),
  }
  const inRepo = action => {
    const before = process.cwd()
    process.chdir(repo)
    try {
      return action()
    } finally {
      process.chdir(before)
    }
  }
  const prior = inRepo(() => ({
    ...policy.checkoutContext({ ...env, GITHUB_SHA: mergeDocs }, event),
    headSha: head,
    checkoutSha: merge,
    runId: '10',
    validatedRunId: '10',
    validatedAt: new Date().toISOString(),
  }))
  async function cli(command, extra = {}) {
    fs.writeFileSync(env.GITHUB_OUTPUT, '')
    const result = await promisify(execFile)(process.execPath, [script, command], {
      cwd: repo,
      env: { ...env, ...extra },
    })
    return {
      ...result,
      outputs: Object.fromEntries(
        fs
          .readFileSync(env.GITHUB_OUTPUT, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(line => {
            const i = line.indexOf('=')
            return [line.slice(0, i), line.slice(i + 1)]
          }),
      ),
    }
  }
  function writeReceipt(value = prior) {
    const folder = path.join(directory, 'ci-validation-receipt')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'receipt.json'), JSON.stringify(value))
  }
  async function server(runs, status = 200, comparison = 'ahead') {
    let calls = 0
    const api = http.createServer((req, res) => {
      calls++
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify(
          req.url.includes('/compare/')
            ? { status: comparison }
            : {
                ['workflow_runs']: runs.map(run => ({
                  id: run.id,
                  event: run.event,
                  status: run.status,
                  conclusion: run.conclusion,
                  ['head_sha']: run.headSha,
                  ['head_branch']: run.headBranch,
                  ['head_repository']: { ['full_name']: run.headRepository },
                  ['created_at']: run.createdAt,
                  ['updated_at']: run.updatedAt,
                })),
              },
        ),
      )
    })
    await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => api.close(resolve)))
    return { url: `http://127.0.0.1:${api.address().port}`, calls: () => calls }
  }
  return {
    directory,
    repo,
    git,
    base,
    head,
    docs,
    merge,
    mergeDocs,
    env,
    event,
    cli,
    prior,
    inRepo,
    writeReceipt,
    server,
  }
}

test('Git fingerprints ignore report text but retain symlink, executable and configuration inputs', t => {
  const f = fixture(t)
  f.inRepo(() => {
    assert.equal(policy.fingerprint(f.head), policy.fingerprint(f.docs))
    assert.notEqual(policy.fingerprint(f.base), policy.fingerprint(f.head))
    assert.equal(policy.fingerprint(f.base, 'game'), policy.fingerprint(f.head, 'game'))
  })
})

test('CLI reuses successful same-base fork PR proof and preserves original validation age', async t => {
  const f = fixture(t)
  const api = await f.server([{ ...candidate, headSha: f.head }])
  const extra = { GITHUB_API_URL: api.url }
  assert.equal((await f.cli('prepare', extra)).outputs['candidate-run-id'], '10')
  f.writeReceipt()
  const decision = (await f.cli('decide')).outputs
  assert.equal(decision.run, 'false')
  assert.equal(decision.mode, 'reuse')
  const results = needs('false')
  results.plan.outputs = decision
  assert.equal(
    (await f.cli('finish', { CI_JOB_RESULTS: JSON.stringify(results) })).outputs.save,
    'true',
  )
  const receipt = JSON.parse(
    fs.readFileSync(path.join(f.directory, 'ci-validation-receipt/receipt.json')),
  )
  assert.equal(receipt.validatedRunId, '10')
  assert.equal(receipt.validatedAt, f.prior.validatedAt)
  assert.equal(receipt.headSha, f.docs)
})

for (const kind of ['missing', 'malformed', 'different-base', 'failed', 'api-error']) {
  test(`CLI runs full checks for ${kind} evidence`, async t => {
    const f = fixture(t)
    const api = await f.server(
      [{ ...candidate, headSha: f.head, conclusion: kind === 'failed' ? 'failure' : 'success' }],
      kind === 'api-error' ? 503 : 200,
    )
    await f.cli('prepare', { GITHUB_API_URL: api.url })
    if (kind === 'malformed') {
      f.writeReceipt()
      fs.writeFileSync(path.join(f.directory, 'ci-validation-receipt/receipt.json'), '{')
    }
    if (kind === 'different-base') f.writeReceipt({ ...f.prior, baseSha: a })
    assert.equal((await f.cli('decide')).outputs.run, 'true')
  })
}

for (const extra of [{ GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }]) {
  test(`manual fresh run ignores reusable proof: ${JSON.stringify(extra)}`, async t => {
    const f = fixture(t)
    const api = await f.server([{ ...candidate, headSha: f.head }])
    await f.cli('prepare', { GITHUB_API_URL: api.url, ...extra })
    f.writeReceipt()
    assert.equal((await f.cli('decide')).outputs.run, 'true')
    assert.equal(api.calls(), 0)
  })
}

test('unaffected Rust PR jobs skip without installing dependencies or creating proof', async t => {
  const f = fixture(t)
  await f.cli('prepare', { CI_COMPONENT: 'game', CI_WORKFLOW_FILE: 'game-ci.yml' })
  const decision = (await f.cli('decide')).outputs
  assert.equal(decision.mode, 'unaffected')
  assert.equal(decision.run, 'false')
  const results = {
    plan: { result: 'success', outputs: decision },
    clippy: { result: 'skipped' },
    fmt: { result: 'skipped' },
    licenses: { result: 'skipped' },
    test: { result: 'skipped' },
  }
  assert.equal(
    (
      await f.cli('finish', {
        CI_COMPONENT: 'game',
        CI_WORKFLOW_FILE: 'game-ci.yml',
        CI_JOB_RESULTS: JSON.stringify(results),
      })
    ).outputs.save,
    'false',
  )
})

test('guard rejects failed actual job results and never writes successful proof', async t => {
  const f = fixture(t)
  const results = needs('true')
  results['integration-tests'].result = 'failure'
  await assert.rejects(f.cli('finish', { CI_JOB_RESULTS: JSON.stringify(results) }))
  assert.equal(fs.existsSync(path.join(f.directory, 'ci-validation-receipt/receipt.json')), false)
})

test('documentation-only JS PR skips without a prior run', async t => {
  const f = fixture(t)
  f.git('checkout', '-q', '--detach', f.base)
  fs.writeFileSync(path.join(f.repo, 'docs/check.md'), 'documentation only')
  f.git('add', '.')
  f.git('commit', '-qm', 'Update documentation.')
  const head = f.git('rev-parse', 'HEAD')
  const merge = f.git(
    'commit-tree',
    `${head}^{tree}`,
    '-p',
    f.base,
    '-p',
    head,
    '-m',
    'Merge docs.',
  )
  f.git('checkout', '-q', '--detach', merge)
  f.event.pull_request.head.sha = head
  fs.writeFileSync(f.env.GITHUB_EVENT_PATH, JSON.stringify(f.event))
  await f.cli('prepare', { GITHUB_SHA: merge })
  assert.deepEqual((await f.cli('decide')).outputs, {
    run: 'false',
    mode: 'unaffected',
    'validated-run-id': '',
    'validated-at': '',
  })
})

test('latest failed run cannot reuse an older successful artifact', async t => {
  const f = fixture(t)
  const api = await f.server([
    { ...candidate, headSha: f.head },
    { ...candidate, headSha: f.head, id: 11, conclusion: 'failure' },
  ])
  assert.equal(
    (await f.cli('prepare', { GITHUB_API_URL: api.url })).outputs['candidate-run-id'],
    '',
  )
  f.writeReceipt()
  assert.equal((await f.cli('decide')).outputs.run, 'true')
  assert.equal(api.calls(), 1)
})

test('full successful jobs write proof and failed planner cannot authorize skips', async t => {
  const f = fixture(t)
  assert.equal(
    (await f.cli('finish', { CI_JOB_RESULTS: JSON.stringify(needs('true')) })).outputs.save,
    'true',
  )
  const r = JSON.parse(
    fs.readFileSync(path.join(f.directory, 'ci-validation-receipt/receipt.json')),
  )
  assert.equal(r.validatedRunId, '20')
  assert.equal(r.headSha, f.docs)
  assert.ok(Number.isFinite(Date.parse(r.validatedAt)))
  const broken = needs('false')
  broken.plan.result = 'failure'
  await assert.rejects(f.cli('finish', { CI_JOB_RESULTS: JSON.stringify(broken) }))
})

test('force-pushed history cannot borrow an unrelated successful run', async t => {
  const f = fixture(t)
  const api = await f.server([{ ...candidate, headSha: f.head }], 200, 'diverged')
  assert.equal(
    (await f.cli('prepare', { GITHUB_API_URL: api.url })).outputs['candidate-run-id'],
    '',
  )
  f.writeReceipt()
  assert.equal((await f.cli('decide')).outputs.run, 'true')
})

test('independent candidate tree rejects forged receipt fingerprints after CI code changes', async t => {
  const f = fixture(t)
  f.git('checkout', '-q', '--detach', f.docs)
  fs.mkdirSync(path.join(f.repo, 'tools/ci'), { recursive: true })
  fs.writeFileSync(path.join(f.repo, 'tools/ci/policy.cjs'), 'changed workflow inputs')
  f.git('add', '.')
  f.git('commit', '-qm', 'Change CI inputs.')
  const head = f.git('rev-parse', 'HEAD')
  const merge = f.git(
    'commit-tree',
    `${head}^{tree}`,
    '-p',
    f.base,
    '-p',
    head,
    '-m',
    'Merge CI inputs.',
  )
  f.git('checkout', '-q', '--detach', merge)
  f.event.pull_request.head.sha = head
  fs.writeFileSync(f.env.GITHUB_EVENT_PATH, JSON.stringify(f.event))
  const api = await f.server([{ ...candidate, headSha: f.head }])
  await f.cli('prepare', { GITHUB_SHA: merge, GITHUB_API_URL: api.url })
  const fingerprints = f.inRepo(() => ({
    fingerprint: policy.fingerprint(merge),
    headFingerprint: policy.fingerprint(head),
  }))
  f.writeReceipt({ ...f.prior, ...fingerprints })
  assert.equal((await f.cli('decide')).outputs.run, 'true')
})

test('failed-job rerun cannot refresh an expired reuse receipt', async t => {
  const f = fixture(t)
  const results = needs('false')
  results.plan.outputs['validated-at'] = new Date(now - 25 * 3600000).toISOString()
  await assert.rejects(f.cli('finish', { CI_JOB_RESULTS: JSON.stringify(results) }))
  assert.equal(fs.existsSync(path.join(f.directory, 'ci-validation-receipt/receipt.json')), false)
})

test('a later failed manual attempt blocks an older PR success, including reruns of older IDs', async t => {
  const f = fixture(t)
  const manual = {
    ...candidate,
    headSha: f.head,
    id: 9,
    event: 'workflow_dispatch',
    conclusion: 'failure',
    updatedAt: new Date(now).toISOString(),
  }
  const prior = { ...candidate, headSha: f.head, updatedAt: new Date(now - 1000).toISOString() }
  assert.equal(policy.latestCandidate([prior, manual], context, 20).id, 9)
  const api = await f.server([prior, manual])
  assert.equal(
    (await f.cli('prepare', { GITHUB_API_URL: api.url })).outputs['candidate-run-id'],
    '',
  )
  f.writeReceipt()
  assert.equal((await f.cli('decide')).outputs.run, 'true')
})
