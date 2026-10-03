// `M249` `D` (`D1370`) — `tflw doctor`: what a project will run with, read offline. Since `M267`
// (`D1431`-`D1437`) it fails exactly when `tflw run` with the same flags would refuse before its
// first test, and reports probable mistakes as warnings that never change the exit code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { diagnose, diagnoseAllEnvs, renderAllEnvs, renderDoctor } from '../src/doctor.js';

const cliEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.cjs');
const execFileAsync = promisify(execFile);
/** The shell a CLI test runs under: this one, without the variables a test means to be unset. */
function shell(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  delete env.TFLW_ENV;
  delete env.M267_UNSET_TOKEN;
  return env;
}
const API_TEST = 'test "t"\n  api GET /health\n  expect status equals 200\n';

const CONFIG = [
  'env local default',
  '  api "http://localhost:4001/v1"',
  '  api inventory "http://localhost:4002"',
  '',
  'env secure',
  '  api "https://localhost:8443/v1"',
  '  insecure true',
  '  cert "./certs/client.crt"',
  '  key "./certs/client.key"',
  '',
].join('\n');

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-doctor-'));
  for (const [name, body] of Object.entries(files)) {
    if (name.includes('/')) await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), body);
  }
  return dir;
}

test('a healthy API-only project: its env, its services, the suite, and no problem', async () => {
  const dir = await project({ 'tflw.config': CONFIG, 'a.tflw': 'test "t"\n  api GET /health\n  expect status equals 200\n' });
  try {
    const r = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(r.ok, true, r.problems.join('; '));
    assert.deepEqual(r.config, { path: 'tflw.config', env: 'local', envs: ['local', 'secure'] });
    assert.deepEqual(r.services, { '': 'http://localhost:4001/v1', inventory: 'http://localhost:4002' });
    assert.deepEqual(r.suite, { files: 1, tests: 1, browserTests: 0 });
    // `secure`'s client certificate is not on disk, and `tflw check` reads a config's file references
    // whole-file (`TF043`, a warning for a file a `before all` may write): two warnings, no error.
    assert.deepEqual(r.checks, { errors: 0, warnings: 2, first: null });
    assert.deepEqual(r.warnings, ['`tflw check --env local` reports 2 warnings — they do not stop a run']);
    assert.equal(r.proxy.line, 'none set — requests go straight to each service');
    assert.equal(r.tls.line, 'certificates verified; no client certificate');
    assert.match(renderDoctor(r), /✓ nothing here stops a run/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('another env: its own base, insecure said loudly, a client certificate not on disk yet, a proxy nobody reads', async () => {
  const dir = await project({ 'tflw.config': CONFIG, 'a.tflw': API_TEST });
  try {
    const r = await diagnose(dir, { env: 'secure', version: '9.9.9', nodeVersion: 'v22.11.0', environ: { HTTPS_PROXY: 'http://proxy:3128' } });
    assert.equal(r.ok, true, 'none of these stops a run');
    assert.equal(r.config.env, 'secure');
    assert.deepEqual(r.services, { '': 'https://localhost:8443/v1' });
    assert.equal(r.tls.insecure, true);
    assert.match(r.tls.line, /^insecure true — certificates are NOT verified/);
    assert.deepEqual(r.tls.clientCert, { cert: 'certs/client.crt', key: 'certs/client.key', onDisk: false });
    assert.match(r.proxy.line, /HTTPS_PROXY set; .* only when NODE_USE_ENV_PROXY=1 \(it is not\)/);
    // `M267` (`D1435`) — `insecure true` is a warning now as well as a fact, and a warning is not a problem.
    assert.ok(r.warnings.some((w) => /^env secure has `insecure true`: certificates are not verified/.test(w)), r.warnings.join('; '));
    assert.match(renderDoctor(r), /^⚠ env secure has `insecure true`/m);
    assert.match(renderDoctor(r), /✓ nothing here stops a run/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('machine and project: no config, an old Node, and browser tests with no browser', async () => {
  const empty = await project({});
  const browser = await project({ 'tflw.config': CONFIG, 'ui.tflw': 'test "page"\n  open "/"\n' });
  try {
    const none = await diagnose(empty, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(none.ok, false);
    assert.match(none.problems[0]!, /^no tflw\.config in .* — run `tflw init` here/);
    const old = await diagnose(browser, { version: '9.9.9', nodeVersion: 'v20.10.0', environ: {} });
    assert.equal(old.node.supported, false);
    assert.ok(old.problems.some((p) => /Node v20\.10\.0 is older than 22/.test(p)), old.problems.join('; '));
    // A scratch directory resolves no `playwright`, which is the "not installed" arm.
    assert.ok(old.problems.some((p) => /1 test drives a browser and `playwright` is not installed here/.test(p)), old.problems.join('; '));
    assert.equal(old.suite.browserTests, 1);
  } finally {
    await rm(empty, { recursive: true, force: true });
    await rm(browser, { recursive: true, force: true });
  }
});

// `M266` (`D1430`) — the env's required secrets, by name, set or not, never a value. A required name
// that is not set is the fourth thing that fails doctor, since `run` refuses before its first request.
const PER_ENV = [
  'require env EVERY_TOKEN',
  'env local default',
  '  api "http://localhost:4001/v1"',
  '',
  'env staging',
  '  api "https://staging.example.com"',
  '  require env STG_TOKEN',
  '',
].join('\n');

test('secrets: the env\'s own names are marked, an unset one fails doctor, and no value is printed', async () => {
  const dir = await project({ 'tflw.config': PER_ENV, 'a.tflw': API_TEST });
  try {
    const staging = await diagnose(dir, { env: 'staging', version: '9.9.9', nodeVersion: 'v22.11.0', environ: {}, runEnviron: { EVERY_TOKEN: 'e-v4lue' } });
    assert.equal(staging.ok, false);
    assert.deepEqual(staging.secrets.required, [
      { name: 'EVERY_TOKEN', env: null, set: true },
      { name: 'STG_TOKEN', env: 'staging', set: false },
    ]);
    assert.equal(staging.secrets.line, 'EVERY_TOKEN, STG_TOKEN (env staging only) — not set: STG_TOKEN');
    assert.ok(staging.problems.some((p) => /^STG_TOKEN \(required by env staging\) is required by `require env` and not set/.test(p)), staging.problems.join('; '));
    assert.match(renderDoctor(staging), /^secrets {3}EVERY_TOKEN, STG_TOKEN/m);
    assert.doesNotMatch(renderDoctor(staging), /e-v4lue/, 'a value never reaches the output');

    // Control: `local` does not require the staging secret, so the same shell passes.
    const local = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {}, runEnviron: { EVERY_TOKEN: 'e-v4lue' } });
    assert.equal(local.ok, true, local.problems.join('; '));
    assert.equal(local.secrets.line, 'EVERY_TOKEN — all set');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('secrets: a config with no `require env` says so, and the shell alone is read when no `.env` is passed', async () => {
  const dir = await project({ 'tflw.config': CONFIG });
  try {
    const r = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(r.secrets.line, 'none required');
    assert.deepEqual(r.secrets.required, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- `M267` ---------------------------------------------------------------------------------------

// `secure` declares no `inventory` service, so a file that calls it validates under `local` only.
const INVENTORY_TEST = 'test "stock"\n  api inventory GET /items\n  expect status equals 200\n';

test('`M267` (`D1432`): the checks `run` makes fail doctor under the env they fail in, and only there', async () => {
  const dir = await project({ 'tflw.config': CONFIG, 'stock.tflw': INVENTORY_TEST });
  try {
    const local = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(local.ok, true, local.problems.join('; '));
    const secure = await diagnose(dir, { env: 'secure', version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(secure.ok, false);
    assert.equal(secure.checks.errors, 1);
    assert.equal(secure.checks.first?.file, 'stock.tflw');
    assert.equal(secure.checks.first?.line, 2);
    const problem = secure.problems.find((p) => p.startsWith('`tflw check --env secure` reports 1 error'));
    assert.ok(problem, secure.problems.join('; '));
    assert.match(problem!, /so `tflw run` refuses before its first test — the first: TF\d{3} at stock\.tflw:2, /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`M267` (`D1432`): a file that does not parse fails doctor, and no test files at all is `run`\'s refusal', async () => {
  const broken = await project({ 'tflw.config': CONFIG, 'a.tflw': API_TEST, 'b.tflw': 'this is not a test file\n' });
  const empty = await project({ 'tflw.config': CONFIG });
  try {
    const r = await diagnose(broken, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(r.ok, false);
    assert.equal(r.checks.first?.file, 'b.tflw');
    assert.doesNotMatch(renderDoctor(r), /do not parse/, 'the suite line no longer carries its own half of this');
    // Narrowed to the good file, as `tflw run a.tflw` is: the broken one is not this run's business.
    const narrowed = await diagnose(broken, { files: ['a.tflw'], version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(narrowed.ok, true, narrowed.problems.join('; '));
    assert.equal(narrowed.suite.files, 1);
    const none = await diagnose(empty, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(none.ok, false);
    assert.ok(none.problems.some((p) => /^no `\.tflw` test files given or found/.test(p)), none.problems.join('; '));
  } finally {
    await rm(broken, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
});

/** A `playwright` that resolves from the project, with exactly `downloaded` engines on disk. */
async function withPlaywright(dir: string, downloaded: readonly string[]): Promise<void> {
  await mkdir(join(dir, 'node_modules', 'playwright'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'playwright', 'package.json'), JSON.stringify({ name: 'playwright', version: '1.0.0-fake', main: 'index.js' }));
  const engines = ['chromium', 'firefox', 'webkit'].map((e) => `${e}: { executablePath: () => ${downloaded.includes(e) ? '__filename' : "''"} }`);
  await writeFile(join(dir, 'node_modules', 'playwright', 'index.js'), `module.exports = { ${engines.join(', ')} };\n`);
}

const WEB_CONFIG = 'env local default\n  web "http://localhost:3000"\n';

test('`M267` (`D1433`): the engine `run` will launch must be downloaded, not any engine', async () => {
  const dir = await project({ 'tflw.config': WEB_CONFIG, 'ui.tflw': 'test "page"\n  open "/"\n' });
  try {
    await withPlaywright(dir, ['firefox']);
    const plain = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.deepEqual(plain.browsers.installed, ['firefox']);
    assert.equal(plain.browsers.engine, 'chromium');
    assert.equal(plain.browsers.line, 'playwright 1.0.0-fake: firefox · run uses chromium');
    assert.equal(plain.ok, false);
    assert.ok(
      plain.problems.some((p) => p === '1 test drives a browser and chromium, the engine `tflw run` launches, is not downloaded (firefox is) — `tflw install-browsers`, or run with `--browser firefox`'),
      plain.problems.join('; '),
    );
    const firefox = await diagnose(dir, { browser: 'firefox', version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(firefox.ok, true, firefox.problems.join('; '));
    const webkit = await diagnose(dir, { browser: 'webkit', version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.ok(webkit.problems.some((p) => /webkit, the engine `tflw run` --browser webkit launches, is not downloaded .* `tflw install-browsers --browser webkit`/.test(p)), webkit.problems.join('; '));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`M267` (`D1434`): `--forbid-insecure` turns the `insecure true` warning into `run`\'s refusal', async () => {
  const dir = await project({ 'tflw.config': CONFIG, 'a.tflw': API_TEST });
  try {
    const r = await diagnose(dir, { env: 'secure', forbidInsecure: true, version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /^env secure has `insecure true` and `--forbid-insecure` was given, so `tflw run` refuses/.test(p)), r.problems.join('; '));
    assert.ok(!r.warnings.some((w) => /insecure true/.test(w)), 'said once, as the problem');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`M267` (`D1435`, `D1436`): a `.env` git would commit is a warning, decided by git, and never fails doctor', async () => {
  const dir = await project({ 'tflw.config': CONFIG, 'a.tflw': API_TEST, '.env': 'TOKEN=x\n' });
  const git = (...args: string[]): void => {
    const r = spawnSync('git', args, { cwd: dir, stdio: 'ignore' });
    assert.equal(r.status, 0, `git ${args.join(' ')}`);
  };
  const leak = /^`\.env` is not ignored by git/;
  try {
    const outside = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.ok(!outside.warnings.some((w) => leak.test(w)), 'not a repository: nothing is about to be committed');
    git('init', '-q');
    const exposed = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.ok(exposed.warnings.some((w) => leak.test(w)), exposed.warnings.join('; '));
    assert.equal(exposed.ok, true, 'a warning never fails doctor');
    const text = renderDoctor(exposed);
    assert.ok(text.indexOf('⚠ `.env`') < text.indexOf('✓ nothing here stops a run'), 'warnings print above the verdict');
    await writeFile(join(dir, '.gitignore'), '.env\n');
    const ignored = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.ok(!ignored.warnings.some((w) => leak.test(w)), ignored.warnings.join('; '));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`M267` (`D1437`): `--all-envs` gives one verdict per env and fails when any env does', async () => {
  const dir = await project({ 'tflw.config': CONFIG, 'stock.tflw': INVENTORY_TEST });
  const single = await project({ 'tflw.config': 'env only default\n  api "http://localhost:4001/v1"\n', 'a.tflw': API_TEST });
  try {
    const r = await diagnoseAllEnvs(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(r.ok, false);
    assert.deepEqual(r.envs.map((e) => [e.name, e.ok]), [['local', true], ['secure', false]]);
    const text = renderAllEnvs(r);
    assert.match(text, /^local {3}✓/m);
    assert.match(text, /^secure  ✗ `tflw check --env secure` reports 1 error/m);
    assert.match(text, /^✗ 1 of 2 envs cannot run from here/m);
    const one = await diagnoseAllEnvs(single, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(one.envs.length, 1);
    assert.equal(one.ok, true, JSON.stringify(one.envs));
    assert.match(renderAllEnvs(one), /✓ nothing here stops a run, under any of 1 env$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(single, { recursive: true, force: true });
  }
});

test('`M267` (`D1434`, `D1437`): the CLI takes run\'s flags with run\'s meaning, and refuses what makes no sense', async () => {
  const dir = await project({ 'tflw.config': CONFIG, 'stock.tflw': INVENTORY_TEST });
  const doctor = async (...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    try {
      const { stdout, stderr } = await execFileAsync('node', [cliEntry, 'doctor', ...args], { cwd: dir, env: shell() });
      return { code: 0, stdout, stderr };
    } catch (e) {
      const x = e as { code: number; stdout: string; stderr: string };
      return { code: x.code, stdout: x.stdout, stderr: x.stderr };
    }
  };
  try {
    assert.equal((await doctor()).code, 0);
    const all = await doctor('--all-envs', '--json');
    assert.equal(all.code, 1);
    assert.deepEqual((JSON.parse(all.stdout) as { envs: { name: string }[] }).envs.map((e) => e.name), ['local', 'secure']);
    const both = await doctor('--all-envs', '--env', 'local');
    assert.equal(both.code, 2);
    assert.match(both.stderr, /`--all-envs` judges every env, so `--env` beside it has nothing to choose/);
    const engine = await doctor('--browser', 'opera');
    assert.equal(engine.code, 2);
    assert.match(engine.stderr, /--browser expects one of chromium, firefox, webkit, got "opera"/);
    const typo = await doctor('stok.tflw');
    assert.equal(typo.code, 2);
    assert.match(typo.stderr, /no test file `stok\.tflw` — nothing exists at that path\.\n {2}did you mean `stock\.tflw`\?/);
    assert.equal((await doctor('--seed', '4')).code, 2, 'a flag that cannot change the verdict is not doctor\'s');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`M267` (§2): for each env, `doctor` exits 0 exactly when `run` gets past every check before its first test', async () => {
  // Port 9 is on fetch's blocked list, so a run that starts fails its request at once (exit 1)
  // without a service, and only a refusal before the first test exits 2.
  const config = [
    'env ready default',
    '  api "http://127.0.0.1:9/v1"',
    '  api inventory "http://127.0.0.1:9"',
    '',
    'env noservice',
    '  api "http://127.0.0.1:9/v1"',
    '',
    'env secret',
    '  api "http://127.0.0.1:9/v1"',
    '  api inventory "http://127.0.0.1:9"',
    '  require env M267_UNSET_TOKEN',
    '',
  ].join('\n');
  const dir = await project({ 'tflw.config': config, 'stock.tflw': INVENTORY_TEST });
  const cli = async (...args: string[]): Promise<number> => {
    try {
      await execFileAsync('node', [cliEntry, ...args], { cwd: dir, env: shell() });
      return 0;
    } catch (e) {
      return (e as { code: number }).code;
    }
  };
  try {
    const verdicts: string[] = [];
    for (const env of ['ready', 'noservice', 'secret']) {
      const doctor = await cli('doctor', '--env', env);
      const run = await cli('run', '--env', env);
      verdicts.push(`${env}: doctor ${doctor}, run ${run}`);
      assert.equal(doctor === 0, run !== 2, verdicts.join('; '));
    }
    // The control: the fixture really has both kinds of env, or the agreement above is vacuous.
    assert.deepEqual(verdicts, ['ready: doctor 0, run 1', 'noservice: doctor 1, run 2', 'secret: doctor 1, run 2']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
