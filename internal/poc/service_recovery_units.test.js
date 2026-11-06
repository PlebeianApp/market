const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const deployment = path.join(__dirname, '../../deploy/sidequest-mvp');

for (const name of ['plebeian-friday-authority-recovery.service', 'plebeian-friday-coordinator-recovery.service',
  'plebeian-friday-site-recovery.service']) {
  test(`${name} restarts boundedly without weakening its service sandbox`, () => {
    const unit = fs.readFileSync(path.join(deployment, name), 'utf8');
    assert.match(unit, /^Restart=on-failure$/m);
    assert.match(unit, name.includes('-site-') ? /^RestartSec=5s$/m : /^RestartSec=2s$/m);
    assert.match(unit, /^StartLimitIntervalSec=60$/m);
    assert.match(unit, /^StartLimitBurst=5$/m);
    assert.match(unit, /^NoNewPrivileges=yes$/m);
    assert.match(unit, /^PrivateTmp=yes$/m);
    assert.match(unit, /^ProtectSystem=strict$/m);
    assert.match(unit, /^ProtectHome=yes$/m);
    assert.match(unit, /sidequest-mvp-r4-recovery\/bin\/verify-friday-separated-target\.py/);
  });
}

test('all recovery units invoke the one exact release verifier', () => {
  for (const name of ['plebeian-friday-authority-recovery.service', 'plebeian-friday-coordinator-recovery.service',
    'plebeian-friday-site-recovery.service']) {
    const unit = fs.readFileSync(path.join(deployment, name), 'utf8');
    assert.match(unit, /sidequest-mvp-r4-recovery\/bin\/verify-friday-separated-target\.py/);
  }
  const verifier = fs.readFileSync(path.join(deployment, 'verify-sidequest-recovery.py'), 'utf8');
  for (const artifact of ['plebeian-friday-authority', 'plebeian-friday-coordinator',
    'plebeian-friday-terminal-executor', 'plebeian-auctions-mvp']) assert.match(verifier, new RegExp(`"${artifact}"`));
  for (const service of ['plebeian-friday-authority.service', 'plebeian-friday-coordinator.service',
    'plebeian-friday-site.service']) assert.ok(verifier.includes(`"${service}"`));
});

test('recovery verifier rejects absent and changed exact application pins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plebeian-recovery-verifier.'));
  try {
    const release = path.join(root, 'release'), bin = path.join(release, 'bin');
    fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
    const baseGuard = path.join(bin, 'verify-friday-separated-base.py');
    fs.copyFileSync(path.join(__dirname, '../../deploy/friday/separated/verify-friday-separated-target.py'), baseGuard);
    fs.chmodSync(baseGuard, 0o755);
    const pin = '1'.repeat(64), application = path.join(root, 'application.json');
    const environment = path.join(root, 'friday.env');
    const paths = {
      FRIDAY_APPLICATION: '/etc/plebeian-auctions-friday/application.json',
      FRIDAY_NETWORK_ROOT: '/var/lib/plebeian-auctions-friday/network-separated',
      FRIDAY_NETWORK_FACTS: '/var/lib/plebeian-auctions-friday/network-separated/network-facts.json',
      FRIDAY_DKG_RESULT: '/var/lib/plebeian-auctions-friday/separated-inputs/runtime-binding.json',
      FRIDAY_PARTICIPANT_BIN: '/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/coco-demo-frost-participant-3of4',
      FRIDAY_TERMINAL_EXECUTOR_BIN: '/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/plebeian-friday-terminal-executor',
      FRIDAY_COORDINATOR_DB: '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/operations.sqlite3',
      FRIDAY_COORDINATOR_ANCHOR_DB: '/var/lib/plebeian-auctions-friday-anchor-separated/coordinator.sqlite3',
      FRIDAY_FUNDING_ABORT_ANCHOR_DB: '/var/lib/plebeian-auctions-friday-anchor-separated/funding-abort.sqlite3',
      FRIDAY_FIPS_CONFIG: '/var/lib/plebeian-auctions-friday/fips/identity/fips.yaml',
      FRIDAY_FIPS_IDENTITY_KEY: '/var/lib/plebeian-auctions-friday/fips/identity/fips.key',
    };
    const values = { ...paths, FRIDAY_ROLE: 'APPLICATION', FRIDAY_FIPS_UNDERLAY_IPV4: '139.162.161.233',
      FRIDAY_FIPS_ULA: 'fd00::5', FRIDAY_P2P_PORT: '27656', FRIDAY_RPC_PORT: '27657',
      FRIDAY_SIGNER_PORT: '39101', FRIDAY_MINT_PORT: '3438', FRIDAY_SITE_PORT: '8180',
      POC_FRIDAY_BROWSER_READY: 'true', POC_FRIDAY_RECOVERY_ONLY: 'false', POC_FRIDAY_R20_CLOSE_TRIGGER: 'true',
      FRIDAY_OBSERVER_RECEIPT_SHA256: pin, FRIDAY_OBSERVER_NODE_ID: '2'.repeat(40),
      PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS: '10', PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS: '2' };
    for (const name of ['FRIDAY_DKG_MANIFEST_DIGEST', 'FRIDAY_SEPARATED_BOOTSTRAP_DIGEST',
      'FRIDAY_SEPARATED_RUNTIME_DIGEST', 'FRIDAY_OWNER_APPROVAL_PUBLIC_KEY', 'FRIDAY_DEPLOYMENT_ANCHOR_SHA256',
      'FRIDAY_NETWORK_FACTS_SHA256', 'POC_FRIDAY_BROWSER_PINS_SHA256', 'POC_FRIDAY_HEALTH_PINS_SHA256']) values[name] = pin;
    fs.writeFileSync(environment, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
    const valid = { schema: 'PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1', role: 'APPLICATION', participant_id: 0,
      deployment_id: 'friday-demo-20261030-separated-v1', run_id: 'friday-demo-20261030-separated-v1-run1',
      application_host_id: 'linode-109290386', application_ipv4: '139.162.161.233', application_fips_ula: 'fd00::5',
      fips_ulas: ['fd00::1', 'fd00::2', 'fd00::3', 'fd00::4'], comet_p2p_port: 27656, comet_rpc_port: 27657,
      signer_rpc_port: 39101, mint_port: 3438, cashu_mint_url: 'https://139.162.161.233', site_port: 8180,
      network_root: '/var/lib/plebeian-auctions-friday/network-separated',
      dkg_root: '/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3',
      coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime',
      coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/coordinator-rpc-identity.key' };
    const verifier = path.join(deployment, 'verify-sidequest-recovery.py');
    const code = "import runpy,sys; from pathlib import Path; n=runpy.run_path(sys.argv[1]); n['verify'].__globals__['ARTIFACTS']={}; n['verify'](Path(sys.argv[2]),Path(sys.argv[3]),sys.argv[5],Path(sys.argv[4]))";
    const run = () => spawnSync('python3', ['-I', '-S', '-B', '-c', code, verifier, environment, application, release,
      'plebeian-friday-site.service'], { encoding: 'utf8' });
    fs.writeFileSync(application, JSON.stringify(valid));
    assert.equal(run().status, 0);
    fs.writeFileSync(application, '{}');
    assert.notEqual(run().status, 0);
    fs.writeFileSync(application, JSON.stringify({ ...valid, deployment_id: 'wrong-deployment' }));
    assert.notEqual(run().status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('signers retain fail-stop restart behavior', () => {
  for (const name of ['plebeian-friday-signer-r12.service', 'plebeian-friday-signer-r13.service']) {
    const unit = fs.readFileSync(path.join(deployment, name), 'utf8');
    assert.match(unit, /^Restart=no$/m);
    assert.doesNotMatch(unit, /^Restart=on-failure$/m);
  }
});
