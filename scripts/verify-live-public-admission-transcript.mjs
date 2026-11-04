#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const AGENT = '/tmp/ssh-1UGv8p0CgFNJ/agent.263905';
const KNOWN = '/home/maximoto/Documents/Codex/2026-10-28/task-4/remaining-fifteen-fips-probes-r2-socket/known-hosts';
const APP_KNOWN = '/home/maximoto/Documents/Codex/2026-10-28/task-4/app-https-firewall-combined-preparation-r2/known-hosts/APP';
const HOSTS = [
  { name: 'V1', address: '172.105.64.142', participantId: 1 },
  { name: 'V2', address: '172.105.95.57', participantId: 2 },
  { name: 'V3', address: '172.104.240.217', participantId: 3 },
];
const [operationId, verifier, publicPackage] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/.test(operationId || '') || !verifier?.startsWith('/') || !publicPackage?.startsWith('/')) {
  throw new Error('usage: verify-live-public-admission-transcript OPERATION_ID VERIFIER PUBLIC_PACKAGE');
}

function run(command, args, stdin = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, SSH_AUTH_SOCK: AGENT }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2048); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}; diagnosticSha256=${bytesToHex(sha256(utf8ToBytes(stderr)))}`)));
    child.stdin.end(stdin);
  });
}

function sshArgs(host, knownHosts, remote) {
  return ['-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${knownHosts}`, `root@${host}`, remote];
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('public evidence contains a non-safe integer');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value !== 'object') throw new Error('public evidence contains an unsupported value');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

const query = String.raw`/usr/bin/python3 -c 'import json,sqlite3,sys; p=sys.argv[1]; method=sys.argv[2]; op=sys.argv[3]; c=sqlite3.connect("file:"+p+"?mode=ro",uri=True); q="select response_json from demo_fips_admission_rpc_journal where status=\"complete\" and json_extract(response_json,\"$.method\")=?"; a=[method]; q+=(" and json_extract(response_json,\"$.payload.operation_id\")=?" if method!="policy" else ""); a+=([op] if method!="policy" else []); q+=" order by rowid desc limit 1"; r=c.execute(q,a).fetchone(); print(r[0] if r else "null")'`;

const records = [];
for (const host of HOSTS) {
  const database = `/var/lib/plebeian-auctions-friday/separated/node-${host.participantId}/admission-safety.sqlite3`;
  const knownHosts = `${KNOWN}/${host.name}`;
  const values = {};
  for (const method of ['policy', 'commit', 'share']) {
    const stdout = await run('ssh', sshArgs(host.address, knownHosts, `${query} ${database} ${method} ${operationId}`));
    const wrapper = JSON.parse(stdout);
    if (wrapper?.method !== method || wrapper?.participantId !== host.participantId || typeof wrapper?.payload !== 'object') {
      throw new Error(`${host.name} returned a wrong-identity ${method} response`);
    }
    if (method !== 'policy' && wrapper.payload.operation_id !== operationId) {
      throw new Error(`${host.name} ${method} belongs to another operation`);
    }
    values[method] = wrapper.payload;
  }
  records.push({ participantId: host.participantId, ...values });
}

const appQuery = String.raw`/usr/bin/python3 -c 'import json,sqlite3,sys; p="/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/admission-sessions.sqlite3"; c=sqlite3.connect("file:"+p+"?mode=ro",uri=True); r=c.execute("select receipt_digest,participant_ids,session_id,completed_json is not null from demo_admission_sessions where operation_id=?",(sys.argv[1],)).fetchone(); print(json.dumps(r,separators=(",",":")))'`;
const appRecord = JSON.parse(await run('ssh', sshArgs('139.162.161.233', APP_KNOWN, `${appQuery} ${operationId}`)));
if (!Array.isArray(appRecord) || !/^[0-9a-f]{64}$/.test(appRecord[0]) || appRecord[1] !== '[1,2,3]' || appRecord[3] !== 0) {
  throw new Error('APP admission session is absent, complete, or has another participant subset');
}
const receiptDigest = appRecord[0];
const sessionId = appRecord[2];
if (records.some((entry) => entry.policy.receiptDigest !== receiptDigest
  || entry.commit.session_id !== sessionId || entry.share.session_id !== sessionId
  || entry.commit.authorization_digest !== entry.share.authorization_digest)) {
  throw new Error('public signer transcript differs from the APP session');
}
const evidence = records.map((entry) => entry.policy);
const evidenceDigest = bytesToHex(sha256(utf8ToBytes(canonical([
  'COCO_DEMO_FROST_ADMISSION_PARTICIPANT_EVIDENCE_V1', evidence,
]))));
const messageDigest = bytesToHex(sha256(concatBytes(
  utf8ToBytes('COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1'),
  hexToBytes(receiptDigest), hexToBytes(evidenceDigest),
)));
const transcript = {
  message_digest: messageDigest,
  commitments: records.map((entry) => ({
    participant_id: entry.participantId,
    hiding_hex: entry.commit.hiding_hex,
    binding_hex: entry.commit.binding_hex,
  })),
  shares: records.map((entry) => ({ participant_id: entry.participantId, share_hex: entry.share.share_hex })),
};
const verified = JSON.parse(await run(verifier, [publicPackage], JSON.stringify(transcript)));
if (verified?.status !== 'PASS' || JSON.stringify(verified.participantIds) !== '[1,2,3]') {
  throw new Error('public transcript verifier returned a malformed result');
}
process.stdout.write(`${JSON.stringify({
  schema: 'PLEBEIAN_LIVE_PUBLIC_ADMISSION_TRANSCRIPT_DIAGNOSTIC_V1',
  status: 'PASS', operationId, sessionId, participantIds: [1, 2, 3],
  signatureSha256: verified.signatureSha256,
  privateKeyOrSecretShareRead: false,
}, null, 2)}\n`);
