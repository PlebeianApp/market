#!/usr/bin/env python3
"""signer-session.bpmn — the generator for the signer module's session lifecycle.

One command regenerates everything in this directory:

    python3 build.py

It writes
  * signer-session.bpmn        BPMN 2.0 collaboration (semantic model + DI)
  * viewer.html                self-contained offline viewer (no CDN, no network)
  * _render-canvas.html        the second page the PNG is rendered from
  * signer-session.png         full-resolution render (via verify.cjs)
  * checks.txt                 the two self-checks + the headless import report

The subject is `signer/` in this assembly: the spec is `signer/signer.md`, the
first implementation is `signer/ts/`, and the evidence is `signer/evidence/`.
Everything below is taken from those files, not from a summary of them; the
per-node notes in the code say which file each branch comes from.

Layout is a grid, never hand-placed coordinates: a node's position is
`(col, row)` inside a lane, and pool height, lane height and pool width are
derived. Two self-checks run on every build and must both report zero:

  1. no annotation box overlaps a node box;
  2. no edge polyline passes through a box.

Auto-layout tools cannot lay out a collaboration (they lay out only the first
participant and never route message flows), so the layout lives here.

Vendored assets (vendor/) are the bpmn-js 18.30.1 dist files: the navigated
viewer UMD build, diagram-js.css, bpmn-js.css, the bpmn icon font (as a
base64 woff2), and the icon class sheet. `ensure_vendor()` copies them from a
local bpmn-js install when they are missing.
"""
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(HERE, 'vendor')
# where ensure_vendor() looks for the bpmn-js dist files when vendor/ is empty
VENDOR_SOURCES = [
    '/home/admin_maxime/work/node_modules/bpmn-js/dist',
    os.path.join(HERE, 'node_modules', 'bpmn-js', 'dist'),
]
OUT_BPMN = os.path.join(HERE, 'signer-session.bpmn')
OUT_VIEWER = os.path.join(HERE, 'viewer.html')
OUT_RENDER = os.path.join(HERE, '_render-canvas.html')
OUT_PNG = os.path.join(HERE, 'signer-session.png')
OUT_CHECKS = os.path.join(HERE, 'checks.txt')
VERIFY = os.path.join(HERE, 'verify.cjs')

# ---------------------------------------------------------------- geometry
COL_W, ROW_H, X0, PAD_RIGHT = 260, 160, 40, 80
POOL_HEADER, LANE_PAD = 34, 20
TASK_W, TASK_H = 210, 92
GW_W, GW_H = 50, 50
EV_W, EV_H = 36, 36
ANN_CHAR_W, ANN_LINE_H = 6.4, 16
ANN_MAX_WIDTH = 286          # column N+1's gutter starts at N + 286

# amber = "this leg is not exercised end to end" (see the viewer's legend)
NOT_EXERCISED_FILL = '#fef3c7'
NOT_EXERCISED_STROKE = '#b45309'

# ---------------------------------------------------------------- the actors
POOLS = ['consumer', 'module', 'ports', 'relay', 'remote']
POOL_TITLE = {
    'consumer': 'Consumer (host app) — the hypothetical composer: a login surface and the ports',
    'module': 'Signer module — the subject of this diagram: `signer/` in this assembly',
    'ports': 'Storage and injected ports — NOT A PARTICIPANT: the consumer implements every one of them',
    'relay': 'Relay — NOT A PARTICIPANT: it is the transport, and no relay is contacted by this build',
    'remote': 'Remote signer — a participant: the NIP-46 peer (bunker:// or nostrconnect://)',
}
LANES = [
    ('L_ui', 'consumer', 'login surface — the host UI (hypothetical: no consumer exists)'),
    ('L_set', 'consumer', 'composer — settings, ports and the mutation-time guard'),
    ('L_life', 'module', 'session lifecycle — idle · connecting · awaiting · active · closing'),
    ('L_cap', 'module', 'capability policy — the allow-list and the identity assertion'),
    ('L_vault', 'module', 'vault — the stored session record (I5)'),
    ('L_impl', 'module', 'lane implementations — one row per lane, plus the lane guards'),
    ('L_store', 'ports', 'storage port — the persisted record'),
    ('L_ports', 'ports', 'crypto · clock · transport · extension (injected by the consumer)'),
    ('L_relay', 'relay', 'the injected transport — the module never opens a relay layer of its own'),
    ('L_peer', 'remote', 'the peer — exercised against the in-process emulator only'),
    ('L_bad', 'remote', 'documented remote failure modes (fail-closed cases)'),
]

# ---------------------------------------------------------------- the process
# id, type, name, pool, lane, col, row, event definition
#   event definition: '' | 'timer' | 'error' (boundary and catch events only)
NODES = [
    # -- consumer / login surface ------------------------------------------
    ('C_boot', 'startEvent', 'Host starts', 'consumer', 'L_ui', 0, 0, ''),
    ('C_ask', 'userTask', 'Ask which lane', 'consumer', 'L_ui', 1, 0, ''),
    ('C_avail', 'exclusiveGateway', 'lane offered here?', 'consumer', 'L_ui', 2, 0, ''),
    ('C_send', 'sendTask', 'Start a session on that lane', 'consumer', 'L_ui', 3, 0, ''),
    ('C_unavail', 'endEvent', 'Lane shown unavailable', 'consumer', 'L_ui', 3, 1, ''),
    ('C_pass', 'userTask', 'Ask for the passphrase', 'consumer', 'L_ui', 6, 2, ''),
    ('C_relogin', 'userTask', 'Ask to log in again', 'consumer', 'L_ui', 7, 2, ''),
    ('C_uri', 'userTask', 'Show the connect URI', 'consumer', 'L_ui', 8, 1, ''),
    ('C_render', 'task', 'Render the observed state', 'consumer', 'L_ui', 11, 0, ''),
    ('C_end', 'endEvent', 'Session over', 'consumer', 'L_ui', 14, 0, ''),
    # -- consumer / composer ----------------------------------------------
    ('C_cfg', 'task', 'Compose settings and ports', 'consumer', 'L_set', 0, 0, ''),
    ('C_guard', 'task', 'Own the mutation-time guard', 'consumer', 'L_set', 7, 0, ''),
    # -- module / session lifecycle ---------------------------------------
    ('S_idle', 'startEvent', 'Session created · idle', 'module', 'L_life', 2, 0, ''),
    ('S_start', 'serviceTask', 'startSession · connecting', 'module', 'L_life', 3, 0, ''),
    ('S_gwrem', 'exclusiveGateway', 'a NIP-46 lane?', 'module', 'L_life', 7, 0, ''),
    ('S_await', 'receiveTask', 'Await the remote approval', 'module', 'L_life', 8, 0, ''),
    ('S_dl', 'boundaryEvent', 'connect deadline 5 min', 'module', 'L_life', 8, 0, 'timer'),
    ('S_act', 'serviceTask', 'Resolve the identity', 'module', 'L_life', 9, 0, ''),
    ('S_gwone', 'exclusiveGateway', 'one session, identity resolved?', 'module', 'L_life', 10, 0, ''),
    ('S_attach', 'serviceTask', 'Attach · active', 'module', 'L_life', 11, 0, ''),
    ('S_refid', 'serviceTask', 'Refuse: no active without identity', 'module', 'L_life', 11, 1, ''),
    ('S_fork', 'parallelGateway', 'sign, encrypt or end?', 'module', 'L_life', 12, 0, ''),
    ('S_end', 'serviceTask', 'endSession · clear the record', 'module', 'L_life', 13, 0, ''),
    ('S_detach', 'serviceTask', 'detachSigner · record kept', 'module', 'L_life', 13, 1, ''),
    ('S_idle2', 'endEvent', 'idle again', 'module', 'L_life', 14, 0, ''),
    ('S_restore', 'serviceTask', 'restoreSession · read the record', 'module', 'L_life', 3, 2, ''),
    ('S_failed', 'serviceTask', 'failed · nothing half-attached', 'module', 'L_life', 10, 3, ''),
    # -- module / capability policy ---------------------------------------
    ('S_sign', 'serviceTask', 'signEvent · identity-bound', 'module', 'L_cap', 12, 1, ''),
    ('S_rpc', 'receiveTask', 'Await the RPC answer', 'module', 'L_cap', 13, 1, ''),
    ('S_rpcdl', 'boundaryEvent', 'RPC deadline 30 s', 'module', 'L_cap', 13, 1, 'timer'),
    ('S_gwver', 'exclusiveGateway', 'verifies and same pubkey?', 'module', 'L_cap', 14, 1, ''),
    ('S_signed', 'sendTask', 'Return the signed event', 'module', 'L_cap', 14, 2, ''),
    ('S_rsign', 'serviceTask', 'Refuse: identity mismatch (I3)', 'module', 'L_cap', 13, 2, ''),
    ('S_caps', 'serviceTask', 'capabilities · allow-list ∩ signer', 'module', 'L_cap', 12, 3, ''),
    ('S_gwg', 'exclusiveGateway', 'permitted and provided?', 'module', 'L_cap', 13, 3, ''),
    ('S_enc', 'sendTask', 'Return the ciphertext', 'module', 'L_cap', 14, 3, ''),
    ('S_renc', 'serviceTask', 'Refuse: capability unavailable (I4)', 'module', 'L_cap', 13, 4, ''),
    # -- module / vault ----------------------------------------------------
    ('S_vwrap', 'serviceTask', 'Wrap · PBKDF2 → AES-GCM', 'module', 'L_vault', 8, 0, ''),
    ('S_vwrite', 'serviceTask', 'Write the envelope (I5)', 'module', 'L_vault', 9, 0, ''),
    ('S_vwerr', 'boundaryEvent', 'the store rejects', 'module', 'L_vault', 9, 0, 'error'),
    ('S_vkind', 'exclusiveGateway', 'which record?', 'module', 'L_vault', 4, 1, ''),
    ('S_vneed', 'exclusiveGateway', 'passphrase supplied?', 'module', 'L_vault', 5, 1, ''),
    ('S_vunlock', 'serviceTask', 'Unlock · floor then derive', 'module', 'L_vault', 6, 1, ''),
    ('S_vfloor', 'exclusiveGateway', 'at or above the floor?', 'module', 'L_vault', 7, 1, ''),
    ('S_vrehyd', 'serviceTask', 'Rehydrate over the transport', 'module', 'L_vault', 8, 1, ''),
    ('S_vlock', 'serviceTask', 'Park in locked · ask', 'module', 'L_vault', 6, 2, ''),
    ('S_vtamper', 'serviceTask', 'Refuse: possible tampering', 'module', 'L_vault', 9, 2, ''),
    ('S_vclear', 'serviceTask', 'Clear the record', 'module', 'L_vault', 13, 1, ''),
    ('S_vgone', 'endEvent', 'record cleared', 'module', 'L_vault', 14, 1, ''),
    ('S_vlegacy', 'exclusiveGateway', 'migrate or re_login?', 'module', 'L_vault', 5, 3, ''),
    ('S_vmigrate', 'serviceTask', 'Wrap the plaintext pair', 'module', 'L_vault', 6, 3, ''),
    ('S_vguard', 'exclusiveGateway', 'ownership guard passes?', 'module', 'L_vault', 7, 3, ''),
    ('S_vmsave', 'serviceTask', 'Write, then delete the plaintext', 'module', 'L_vault', 8, 3, ''),
    ('S_vdiscard', 'serviceTask', 'Discard · a re-login is required', 'module', 'L_vault', 6, 4, ''),
    ('S_vreend', 'endEvent', 're-login required', 'module', 'L_vault', 7, 4, ''),
    ('S_vabort', 'serviceTask', 'Abort · nothing written', 'module', 'L_vault', 8, 4, ''),
    # -- module / lane implementations ------------------------------------
    ('S_avail', 'exclusiveGateway', 'lane offered here?', 'module', 'L_impl', 4, 2, ''),
    ('S_refuse_lane', 'serviceTask', 'Refuse: lane unavailable', 'module', 'L_impl', 4, 4, ''),
    ('S_pick', 'exclusiveGateway', 'which lane?', 'module', 'L_impl', 5, 2, ''),
    ('S_ext', 'task', 'Extension lane · injected NIP-07', 'module', 'L_impl', 6, 0, ''),
    ('S_nsec', 'task', 'nsec lane · local key', 'module', 'L_impl', 6, 1, ''),
    ('S_ncr', 'task', 'ncryptsec lane · NIP-49 unlock', 'module', 'L_impl', 6, 2, ''),
    ('S_bun', 'task', 'bunker lane · connect with the secret', 'module', 'L_impl', 6, 3, ''),
    ('S_nc', 'task', 'nostrconnect lane · URI then bind', 'module', 'L_impl', 6, 4, ''),
    ('S_implgw', 'exclusiveGateway', 'capability usable?', 'module', 'L_impl', 7, 1, ''),
    ('S_ncrgw', 'exclusiveGateway', 'signer unlocked?', 'module', 'L_impl', 7, 2, ''),
    ('S_ncrfail', 'serviceTask', 'Refuse fast: locked signer', 'module', 'L_impl', 7, 3, ''),
    # -- storage and injected ports ---------------------------------------
    ('P_read', 'task', 'Read the persisted record', 'ports', 'L_store', 3, 0, ''),
    ('P_legacy', 'task', 'Hold the legacy plaintext pair', 'ports', 'L_store', 4, 1, ''),
    ('P_del', 'task', 'Delete the stored keys', 'ports', 'L_store', 8, 1, ''),
    ('P_write', 'task', 'Store the envelope', 'ports', 'L_store', 9, 0, ''),
    ('P_supply', 'task', 'Supply the transport and extension', 'ports', 'L_ports', 5, 0, ''),
    ('P_kdf', 'task', 'Derive the key · PBKDF2, AES-GCM', 'ports', 'L_ports', 6, 0, ''),
    ('P_time', 'task', 'Supply the deadlines', 'ports', 'L_ports', 13, 0, ''),
    # -- the transport ----------------------------------------------------
    ('Y_out', 'task', 'Carry the published request', 'relay', 'L_relay', 8, 0, ''),
    ('Y_in', 'task', 'Carry the signer’s events', 'relay', 'L_relay', 13, 0, ''),
    # -- the peer ---------------------------------------------------------
    ('R_recv', 'receiveTask', 'Receive the connect request', 'remote', 'L_peer', 8, 0, ''),
    ('R_appr', 'userTask', 'Approve at the remote device', 'remote', 'L_peer', 9, 0, ''),
    ('R_rpc', 'receiveTask', 'Receive the sign or encrypt RPC', 'remote', 'L_peer', 13, 0, ''),
    ('R_send', 'sendTask', 'Return the signed result', 'remote', 'L_peer', 14, 0, ''),
    ('R_ack', 'task', 'Answer with a bare ack', 'remote', 'L_bad', 8, 1, ''),
    ('R_wrongkey', 'task', 'Sign as a different key', 'remote', 'L_bad', 13, 1, ''),
    ('R_silent', 'task', 'Never answer the RPC', 'remote', 'L_bad', 14, 1, ''),
]

# Specified but not exercised end to end in this build: drawn in amber, never
# drawn as if it were done. The reasons are in the viewer's panels.
NOT_EXERCISED = {
    'S_vwerr', 'S_vwrite',      # a rejecting storage write: no test drives one
    'Y_out', 'Y_in',            # the relay: no relay was ever contacted
    'R_recv', 'R_appr', 'R_rpc', 'R_send', 'R_ack', 'R_wrongkey', 'R_silent',
}

# id, text (<= 6 short lines), pool, lane, col, row, min width
#   columns 0, 1, 2, 4, 5, 10 are used because they host no message-flow and no
#   cross-lane sequence-flow source (checked at build time, below).
ANNOTATIONS = [
    ('An_key',
     'Solid = a sequence flow inside one\nparticipant.\nDashed = a message between two\nparticipants.\nAmber = specified, not exercised\nend to end in this build.',
     'consumer', 'L_set', 0, 1, 190),
    ('An_maturity',
     'No relay is contacted: the NIP-46\nlanes run against an in-process\nemulator. Nothing imports this\nmodule, and no host adapter\n(WebCrypto, storage, relay pool)\nships with it.',
     'consumer', 'L_ui', 1, 3, 190),
    ('An_consumer',
     'The consumer is hypothetical. The\nlogin surface, the settings and the\nports are the composer’s; the\nmodule answers availableLanes()\nso a surface decides through the\ncontract, never through host state.',
     'consumer', 'L_ui', 2, 3, 190),
    ('An_ports',
     'Not a participant. The module\nreaches storage and crypto only\nthrough these ports, and refuses\nwhen one it needs is missing —\nit never reaches for a host default.',
     'ports', 'L_ports', 5, 1, 190),
    ('An_vault',
     'I5: encrypted at rest, or not\npersisted at all. The legacy\nplaintext pair is read ONCE;\nthe guard runs immediately\nbefore the write and can cancel\nit, leaving nothing behind.',
     'module', 'L_vault', 5, 4, 190),
    ('An_locked',
     'A new lane started while the\nsession is locked is refused:\nunlock or end first\n(InvalidTransitionError).',
     'module', 'L_vault', 10, 4, 190),
    ('An_write',
     'Amber here: no test drives a\nrejecting storage write, so this\nbranch is specified and drawn,\nnot proven. The nearest evidence\nis the guard-cancellation case.',
     'module', 'L_vault', 10, 1, 190),
    ('An_attach',
     'After `active`, the caller may\nsign, encrypt or end — each as\nmany times as it likes. This is\nthe contract’s operations over\none session, not a token flow.',
     'module', 'L_life', 10, 1, 190),
    ('An_await',
     'The timer hangs on the receive\ntask, never on a catch event:\na boundary event may attach\nonly to an activity.',
     'module', 'L_life', 10, 2, 190),
    ('An_encrypt',
     'The private-message path is gated\nexactly like the capability set:\nnot provided, or not allowed,\nmeans refuse — never synthesise\nfrom a key the user did not expose.',
     'module', 'L_cap', 10, 3, 190),
    ('An_persist',
     'A session is persisted only when\nthe host gave a storage port, a\ncrypto port AND a passphrase\nsource. Anything less persists\nnothing — there is no plaintext\nfallback.',
     'module', 'L_vault', 10, 0, 190),
    ('An_relay',
     'Not a participant, and not\ncontacted here: the transport is\ninjected by the consumer. A\nNIP-46 lane without one refuses\nrather than opening a relay layer\nof its own.',
     'relay', 'L_relay', 5, 0, 190),
    ('An_remote',
     'The peer is real in BPMN terms and\nhypothetical in fact: only the test\nharness’s in-process emulator has\never answered. “Amber” marks what\na real remote signer still has to\nprove.',
     'remote', 'L_peer', 5, 1, 190),
    ('An_bad',
     'Each of these ends in a typed\nrefusal on the module’s side:\na bare ack never binds (I1), a\nforeign key never signs (I3),\na silent RPC hits its deadline.',
     'remote', 'L_bad', 10, 0, 190),
]

# id, kind (seq|msg), source, target, label, hint
#   hints: auto | vdown | vup | loop | below | above | rightedge | leftedge | overtop
#   a hinted 'vdown'/'vup' is only used where the cell between the two rows is free
EDGES = [
    # -- consumer: the lane choice ----------------------------------------
    ('SF01', 'seq', 'C_boot', 'C_ask', '', 'auto'),
    ('SF02', 'seq', 'C_ask', 'C_avail', '', 'auto'),
    ('SF03', 'seq', 'C_avail', 'C_send', 'yes', 'auto'),
    ('SF04', 'seq', 'C_avail', 'C_unavail', 'no', 'vdown'),
    ('SF05', 'seq', 'C_relogin', 'C_ask', 'log in again', 'overtop'),
    # -- module: the session lifecycle ------------------------------------
    ('SF10', 'seq', 'S_idle', 'S_start', 'startSession', 'auto'),
    ('SF11', 'seq', 'S_start', 'S_avail', '', 'auto'),
    ('SF12', 'seq', 'S_avail', 'S_refuse_lane', 'no', 'vdown'),
    ('SF13', 'seq', 'S_avail', 'S_pick', 'yes', 'auto'),
    ('SF14', 'seq', 'S_pick', 'S_ext', 'extension', 'auto'),
    ('SF15', 'seq', 'S_pick', 'S_nsec', 'nsec', 'auto'),
    ('SF16', 'seq', 'S_pick', 'S_ncr', 'ncryptsec', 'auto'),
    ('SF17', 'seq', 'S_pick', 'S_bun', 'bunker', 'auto'),
    ('SF18', 'seq', 'S_pick', 'S_nc', 'nostrconnect', 'auto'),
    ('SF19', 'seq', 'S_ext', 'S_implgw', '', 'auto'),
    ('SF20', 'seq', 'S_nsec', 'S_implgw', '', 'auto'),
    ('SF21', 'seq', 'S_ncr', 'S_ncrgw', '', 'auto'),
    ('SF22', 'seq', 'S_ncrgw', 'S_implgw', 'yes', 'vup'),
    ('SF23', 'seq', 'S_ncrgw', 'S_ncrfail', 'no', 'vdown'),
    ('SF24', 'seq', 'S_bun', 'S_implgw', '', 'auto'),
    ('SF25', 'seq', 'S_nc', 'S_implgw', '', 'auto'),
    ('SF26', 'seq', 'S_implgw', 'S_gwrem', '', 'auto'),
    ('SF27', 'seq', 'S_ncrfail', 'S_failed', '', 'auto'),
    ('SF28', 'seq', 'S_refuse_lane', 'S_failed', '', 'auto'),
    ('SF29', 'seq', 'S_gwrem', 'S_await', 'yes', 'vdown'),
    ('SF30', 'seq', 'S_gwrem', 'S_act', 'no', 'above'),
    ('SF31', 'seq', 'S_await', 'S_act', 'bound', 'auto'),
    ('SF32', 'seq', 'S_dl', 'S_failed', 'connect deadline', 'auto'),
    ('SF33', 'seq', 'S_act', 'S_gwone', '', 'auto'),
    ('SF34', 'seq', 'S_gwone', 'S_attach', 'yes', 'auto'),
    ('SF35', 'seq', 'S_gwone', 'S_refid', 'no', 'auto'),
    ('SF36', 'seq', 'S_refid', 'S_failed', '', 'rightedge'),
    ('SF37', 'seq', 'S_attach', 'S_fork', '', 'auto'),
    ('SF38', 'seq', 'S_fork', 'S_sign', 'sign', 'auto'),
    ('SF39', 'seq', 'S_fork', 'S_caps', 'encrypt', 'auto'),
    ('SF40', 'seq', 'S_fork', 'S_end', 'end', 'auto'),
    ('SF41', 'seq', 'S_fork', 'S_detach', 'detach', 'auto'),
    ('SF42', 'seq', 'S_sign', 'S_rpc', '', 'auto'),
    ('SF43', 'seq', 'S_rpc', 'S_gwver', '', 'auto'),
    ('SF44', 'seq', 'S_rpcdl', 'S_failed', 'RPC deadline', 'auto'),
    ('SF45', 'seq', 'S_gwver', 'S_signed', 'verifies', 'vdown'),
    ('SF46', 'seq', 'S_gwver', 'S_rsign', 'no', 'rightedge'),
    ('SF47', 'seq', 'S_rsign', 'S_failed', '', 'rightedge'),
    ('SF48', 'seq', 'S_caps', 'S_gwg', '', 'auto'),
    ('SF49', 'seq', 'S_gwg', 'S_enc', 'permitted', 'auto'),
    ('SF50', 'seq', 'S_gwg', 'S_renc', 'no', 'vdown'),
    ('SF51', 'seq', 'S_renc', 'S_failed', '', 'rightedge'),
    ('SF52', 'seq', 'S_end', 'S_vclear', '', 'auto'),
    ('SF53', 'seq', 'S_vclear', 'S_vgone', '', 'auto'),
    ('SF54', 'seq', 'S_end', 'S_idle2', '', 'auto'),
    ('SF55', 'seq', 'S_detach', 'S_idle2', '', 'auto'),
    ('SF56', 'seq', 'S_failed', 'S_idle2', 'failed → idle', 'overtop'),
    # -- module: persist and restore (the vault) --------------------------
    ('SF60', 'seq', 'S_bun', 'S_vwrap', 'persist the token', 'auto'),
    ('SF61', 'seq', 'S_vwrap', 'S_vwrite', '', 'auto'),
    ('SF62', 'seq', 'S_vwrite', 'S_act', '', 'auto'),
    ('SF63', 'seq', 'S_vwerr', 'S_failed', 'write fails', 'auto'),
    ('SF64', 'seq', 'S_restore', 'S_vkind', '', 'auto'),
    ('SF65', 'seq', 'S_vkind', 'S_vneed', 'a vaulted record', 'auto'),
    ('SF66', 'seq', 'S_vkind', 'S_vlegacy', 'a legacy plaintext record', 'auto'),
    ('SF67', 'seq', 'S_vneed', 'S_vlock', 'no passphrase', 'auto'),
    ('SF68', 'seq', 'S_vneed', 'S_vunlock', 'passphrase', 'auto'),
    ('SF69', 'seq', 'S_vunlock', 'S_vfloor', '', 'auto'),
    ('SF70', 'seq', 'S_vfloor', 'S_vrehyd', 'at or above the floor', 'auto'),
    ('SF71', 'seq', 'S_vfloor', 'S_vtamper', 'below the floor', 'auto'),
    ('SF72', 'seq', 'S_vtamper', 'S_failed', '', 'auto'),
    ('SF73', 'seq', 'S_vrehyd', 'S_act', '', 'auto'),
    ('SF74', 'seq', 'S_vlegacy', 'S_vdiscard', 're_login (the default)', 'auto'),
    ('SF75', 'seq', 'S_vlegacy', 'S_vmigrate', 'migrate', 'auto'),
    ('SF76', 'seq', 'S_vmigrate', 'S_vguard', '', 'auto'),
    ('SF77', 'seq', 'S_vguard', 'S_vmsave', 'the guard passes', 'auto'),
    ('SF78', 'seq', 'S_vguard', 'S_vabort', 'the guard throws', 'auto'),
    ('SF79', 'seq', 'S_vmsave', 'S_act', '', 'auto'),
    ('SF80', 'seq', 'S_vabort', 'S_failed', '', 'auto'),
    ('SF81', 'seq', 'S_vdiscard', 'S_vreend', '', 'auto'),
    # -- the peer's own process -------------------------------------------
    ('SF90', 'seq', 'R_recv', 'R_appr', 'the user is asked', 'auto'),
    ('SF91', 'seq', 'R_appr', 'R_rpc', 'bound for this session', 'auto'),
    ('SF92', 'seq', 'R_rpc', 'R_send', '', 'auto'),
    ('SF93', 'seq', 'R_send', 'R_rpc', 'the next RPC', 'overtop'),
    # -- the transport ----------------------------------------------------
    ('SF95', 'seq', 'Y_out', 'Y_in', 'carry', 'auto'),
    # -- messages: the consumer composes and observes ---------------------
    ('MF01', 'msg', 'C_send', 'S_start', 'start a session on a lane', 'vfirst'),
    ('MF02', 'msg', 'C_pass', 'S_vunlock', 'the passphrase', 'vfirst'),
    ('MF03', 'msg', 'S_vlock', 'C_pass', 'ask for the passphrase', 'vfirst'),
    ('MF04', 'msg', 'S_await', 'C_uri', 'the connect URI (it carries the secret)', 'vfirst'),
    ('MF05', 'msg', 'S_vdiscard', 'C_relogin', 'a re-login is required', 'vfirst'),
    ('MF06', 'msg', 'S_attach', 'C_render', 'session snapshots', 'vfirst'),
    ('MF07', 'msg', 'C_guard', 'S_vguard', 'the mutation-time guard', 'vfirst'),
    # -- messages: the module reaches storage, crypto and time through ports
    ('MF10', 'msg', 'S_restore', 'P_read', 'read the record', 'vfirst'),
    ('MF11', 'msg', 'S_vunlock', 'P_kdf', 'PBKDF2-SHA256 → AES-GCM-256', 'vfirst'),
    ('MF12', 'msg', 'S_vwrite', 'P_write', 'the encrypted envelope', 'vfirst'),
    ('MF13', 'msg', 'S_vmsave', 'P_del', 'delete the plaintext keys', 'vfirst'),
    ('MF14', 'msg', 'S_vmigrate', 'P_legacy', 'the plaintext pair, read once', 'vfirst'),
    ('MF15', 'msg', 'S_ext', 'P_supply', 'the injected extension object', 'vfirst'),
    ('MF16', 'msg', 'S_bun', 'P_supply', 'the injected transport', 'vfirst'),
    ('MF17', 'msg', 'S_await', 'P_time', 'the connect deadline', 'vfirst'),
    # -- messages: the peer, over the injected transport -------------------
    ('MF20', 'msg', 'S_bun', 'Y_out', 'publish the connect request', 'vfirst'),
    ('MF21', 'msg', 'S_enc', 'Y_out', 'publish the RPC', 'vfirst'),
    ('MF22', 'msg', 'Y_out', 'R_recv', 'deliver the request', 'vfirst'),
    ('MF23', 'msg', 'Y_out', 'R_rpc', 'deliver the RPC', 'vfirst'),
    ('MF24', 'msg', 'Y_out', 'R_ack', 'deliver (a bare ack comes back)', 'vfirst'),
    ('MF25', 'msg', 'Y_out', 'R_wrongkey', 'deliver (a foreign key answers)', 'vfirst'),
    ('MF26', 'msg', 'Y_out', 'R_silent', 'deliver (nothing answers)', 'vfirst'),
    ('MF27', 'msg', 'R_send', 'Y_in', 'publish the answer', 'vfirst'),
    ('MF28', 'msg', 'R_ack', 'Y_in', 'the bare ack', 'vfirst'),
    ('MF29', 'msg', 'R_wrongkey', 'Y_in', 'an event signed by another key', 'vfirst'),
    ('MF30', 'msg', 'Y_in', 'S_await', 'deliver the approval', 'vfirst'),
    ('MF31', 'msg', 'Y_in', 'S_rpc', 'deliver the RPC answer', 'vfirst'),
]

CONTROL = ('startEvent', 'endEvent', 'intermediateCatchEvent', 'boundaryEvent')
GW_TYPES = ('exclusiveGateway', 'parallelGateway', 'inclusiveGateway')
ACTIVITY = ('task', 'serviceTask', 'sendTask', 'receiveTask', 'userTask', 'manualTask')

# ---------------------------------------------------------------- layout
nodes, anns = {}, {}
for nid, ntype, name, pool, lane, col, row, ev in NODES:
    if ntype in CONTROL:
        w, h = EV_W, EV_H
    elif ntype in GW_TYPES:
        w, h = GW_W, GW_H
    else:
        w, h = TASK_W, TASK_H
    nodes[nid] = dict(id=nid, type=ntype, name=name, pool=pool, lane=lane,
                      col=col, row=row, ev=ev, w=w, h=h)

for aid, text, pool, lane, col, row, minw in ANNOTATIONS:
    lines = text.split('\n')
    assert len(lines) <= 6, '%s: keep notes to 6 lines or fewer' % aid
    w = max(minw, int(max(len(l) for l in lines) * ANN_CHAR_W) + 18)
    assert w < ANN_MAX_WIDTH, '%s: %d px wide crosses the next column gutter' % (aid, w)
    anns[aid] = dict(id=aid, text=text, pool=pool, lane=lane, col=col, row=row,
                     w=w, h=len(lines) * ANN_LINE_H + 14)

# a boundary event must attach to an ACTIVITY in the same cell
for n in nodes.values():
    if n['type'] != 'boundaryEvent':
        continue
    hosts = [o for o in nodes.values()
             if o['lane'] == n['lane'] and o['col'] == n['col'] and o['row'] == n['row']
             and o['type'] in ACTIVITY]
    assert len(hosts) == 1, 'boundary event %s needs exactly one host activity' % n['id']
    n['host'] = hosts[0]['id']

# annotations float over the grid, so they need a column with no flow source:
# a message flow or a cross-lane sequence flow leaves its column through the
# gutter beside it, which is where a note at that column would sit.
msg_cols = {nodes[s]['col'] for _, k, s, _, _, _ in EDGES if k == 'msg'}
cross_cols = {nodes[s]['col'] for _, k, s, t, _, _ in EDGES if k == 'seq'
              and (nodes[s]['lane'] != nodes[t]['lane'])}
for a in anns.values():
    assert a['col'] not in msg_cols, '%s: column %d hosts a message-flow source' % (a['id'], a['col'])
    assert a['col'] not in cross_cols, '%s: column %d hosts a cross-lane source' % (a['id'], a['col'])

lane_rows = {}
for n in nodes.values():
    if n['type'] == 'boundaryEvent':
        continue
    lane_rows[n['lane']] = max(lane_rows.get(n['lane'], 0), n['row'] + 1)
for a in anns.values():
    lane_rows[a['lane']] = max(lane_rows.get(a['lane'], 0), a['row'] + 1)

lane_h = {lid: max(1, lane_rows.get(lid, 1)) * ROW_H + LANE_PAD for lid, _, _ in LANES}
pool_h, pool_y, y = {}, {}, 40
for p in POOLS:
    pool_h[p] = POOL_HEADER + sum(lane_h[l] for l, pp, _ in LANES if pp == p)
    pool_y[p] = y
    y += pool_h[p] + 70
lane_y = {}
for lid, pool, _ in LANES:
    off = pool_y[pool] + POOL_HEADER
    for l2, p2, _ in LANES:
        if p2 != pool:
            continue
        if l2 == lid:
            lane_y[lid] = off
            break
        off += lane_h[l2]
max_col = max([n['col'] for n in nodes.values()] + [a['col'] for a in anns.values()])
pool_w = X0 + max_col * COL_W + TASK_W + PAD_RIGHT

for n in nodes.values():
    if n['type'] == 'boundaryEvent':
        hst = nodes[n['host']]
        n['x'] = hst['x'] + hst['w'] - n['w'] / 2 + 14
        n['y'] = hst['y'] + hst['h'] - n['h'] / 2
    else:
        n['x'] = X0 + n['col'] * COL_W
        n['y'] = lane_y[n['lane']] + n['row'] * ROW_H + (ROW_H - n['h']) / 2
for a in anns.values():
    a['x'] = X0 + a['col'] * COL_W
    a['y'] = lane_y[a['lane']] + a['row'] * ROW_H + 14

# ---------------------------------------------------------------- routing
def anchor(n):
    return dict(l=n['x'], r=n['x'] + n['w'], t=n['y'], b=n['y'] + n['h'],
                cx=n['x'] + n['w'] / 2, cy=n['y'] + n['h'] / 2)

def gutter_candidates(src):
    """Gutters anchored to the CELL, never to the element's own width."""
    cell_right = X0 + src['col'] * COL_W + TASK_W
    return [cell_right + 13 + i * 11 for i in range(3)]

def boxes():
    for nid, n in nodes.items():
        if n['type'] != 'boundaryEvent':
            yield nid, n
    for aid, a in anns.items():
        yield aid, a

def vertical_hits(x, y1, y2, skip):
    lo, hi = min(y1, y2), max(y1, y2)
    hits = 0
    for nid, n in boxes():
        if nid in skip:
            continue
        if n['x'] + 2 < x < n['x'] + n['w'] - 2 and lo < n['y'] + n['h'] - 2 and n['y'] + 2 < hi:
            hits += 1
    return hits

def pick_gutter(src, y1, y2, skip):
    best, best_hits = None, None
    for gx in gutter_candidates(src):
        h = vertical_hits(gx, y1, y2, skip)
        if best_hits is None or h < best_hits:
            best, best_hits = gx, h
        if h == 0:
            break
    return best

def route(src, tgt, hint, kind):
    a, b = anchor(src), anchor(tgt)
    skip = {src['id'], tgt['id']}
    crosses = kind == 'msg' or src['lane'] != tgt['lane'] or src['row'] != tgt['row']
    if hint in ('vdown', 'vup'):
        down = hint == 'vdown'
        y1 = a['b'] if down else a['t']
        y2 = b['t'] if down else b['b']
        start = (a['cx'], y1)
        end = (b['cx'], y2)
        mid = (y1 + y2) / 2
        return [start, (a['cx'], mid), (b['cx'], mid), end]
    if crosses:
        down = b['t'] > a['b']
        s_top = lane_y[src['lane']] + src['row'] * ROW_H
        t_top = lane_y[tgt['lane']] + tgt['row'] * ROW_H
        if down:
            # leave below the source row's boxes, enter above the target's
            start, end = (a['cx'], a['b']), (b['cx'], b['t'])
            exit_y, enter_y = s_top + ROW_H - 15, t_top + 15
        else:
            # leave above the source row's boxes, enter below the target's
            start, end = (a['cx'], a['t']), (b['cx'], b['b'])
            exit_y, enter_y = s_top + 15, t_top + ROW_H - 15
        if abs(a['cx'] - b['cx']) < 8 and vertical_hits(
                a['cx'], min(start[1], end[1]), max(start[1], end[1]), skip) == 0:
            return [start, end]                                    # straight run
        gx = pick_gutter(src, exit_y, enter_y, skip)
        return [start, (a['cx'], exit_y), (gx, exit_y),
                (gx, enter_y), (b['cx'], enter_y), end]
    if hint in ('loop', 'below'):
        yy = max(a['b'], b['b']) + 40
        return [(a['cx'], a['b']), (a['cx'], yy), (b['cx'], yy), (b['cx'], b['b'])]
    if hint == 'above':
        yy = min(a['t'], b['t']) - 40
        return [(a['cx'], a['t']), (a['cx'], yy), (b['cx'], yy), (b['cx'], b['t'])]
    if hint == 'rightedge':
        yy = b['cy']
        return [(a['cx'], a['b']), (a['cx'], yy), (b['r'], yy)]
    if hint == 'leftedge':
        yy = a['t'] - 30
        return [(a['cx'], a['t']), (a['cx'], yy), (18, yy), (18, b['cy']), (b['l'], b['cy'])]
    if hint == 'overtop':
        yy = min(a['t'], b['t']) - 26
        xr = X0 + src['col'] * COL_W + TASK_W + 40
        return [(a['r'], a['cy']), (xr, a['cy']), (xr, yy), (b['cx'], yy), (b['cx'], b['t'])]
    if abs(a['cy'] - b['cy']) < 4 and a['r'] <= b['l']:
        return [(a['r'], a['cy']), (b['l'], b['cy'])]
    if a['r'] <= b['l']:
        mx = (a['r'] + b['l']) / 2
        return [(a['r'], a['cy']), (mx, a['cy']), (mx, b['cy']), (b['l'], b['cy'])]
    yy = min(a['t'], b['t']) - 40
    return [(a['cx'], a['t']), (a['cx'], yy), (b['cx'], yy), (b['cx'], b['t'])]

# ---------------------------------------------------------------- labels
# bpmn-js reads an external label's DI bounds as (centre-x, top-y) and then
# grows the box to fit the text, so the DI bounds are the handle: put the centre
# where the label should sit, and give it a wide enough box not to wrap.
def est_text_size(text, wrap_w=150.0):
    """Deliberately pessimistic: bpmn-js wraps an external label to the width the
    DI declares and lays the lines out itself, so the box a label is checked
    against assumes more lines and more height than the label usually needs."""
    px = len(text) * 6.2
    lines = max(1, int(px / wrap_w) + (1 if px % wrap_w else 0))
    return min(px, wrap_w), 14.0 * lines + 8.0

def label_rect(cx, top, w, h):
    return dict(x=cx - w / 2, y=top, w=w, h=h)

def rect_hit(p, q, pad=2):
    return (p['x'] < q['x'] + q['w'] - pad and q['x'] < p['x'] + p['w'] - pad
            and p['y'] < q['y'] + q['h'] - pad and q['y'] < p['y'] + p['h'] - pad)

def _side(p, q, rr):
    return (q[0] - p[0]) * (rr[1] - p[1]) - (q[1] - p[1]) * (rr[0] - p[0])

def _seg_cross(p1, p2, p3, p4):
    d1, d2 = _side(p3, p4, p1), _side(p3, p4, p2)
    d3, d4 = _side(p1, p2, p3), _side(p1, p2, p4)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))

def poly_hits_rect(wps, box, pad=3):
    """A label must not be printed across a line either: a polyline crosses the
    box if a waypoint is inside it, or a segment cuts one of its four sides."""
    x0, y0 = box['x'] + pad, box['y'] + pad
    x1, y1 = box['x'] + box['w'] - pad, box['y'] + box['h'] - pad
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for px, py in wps:
        if x0 < px < x1 and y0 < py < y1:
            return True
    for (ax, ay), (bx, by) in zip(wps, wps[1:]):
        if _seg_cross((ax, ay), (bx, by), corners[0], corners[1]):
            return True
        if _seg_cross((ax, ay), (bx, by), corners[1], corners[2]):
            return True
        if _seg_cross((ax, ay), (bx, by), corners[2], corners[3]):
            return True
        if _seg_cross((ax, ay), (bx, by), corners[3], corners[0]):
            return True
    return False

# every label is placed against the same obstacles: the node boxes (boundary
# circles included, they are shapes), the annotations, and the labels placed
# before it. Nothing is left to bpmn-js's default, which centres a flow label on
# the middle of its line and lands it on whatever box is there.
obstacles = ([('an_' + aid, dict(a)) for aid, a in anns.items()]
             + [(nid, dict(n)) for nid, n in nodes.items()])
label_problems, labels_di = [], {}
placed = []
for lid, lb in obstacles:
    placed.append(lb)

# every edge polyline, so a label is never printed across a line
edge_polys = {eid: route(nodes[s], nodes[t], hint, kind)
              for eid, kind, s, t, _label, hint in EDGES}

def grid_candidates(base_cx, base_top):
    """A fallback search: tidy spots first, then a small grid around the anchor."""
    out = []
    for dy in (0, -22, 22, -44, 44, 66, -66, 88):
        for dx in (0, -34, 34, -68, 68, -102, 102):
            out.append((base_cx + dx, base_top + dy))
    return out

def place_label(text, cands, wrap_w, owner_id, skip_ids=(), avoid_polys=(),
                own_poly=None):
    """First candidate that touches no box and no line; the closest if none.

    Two passes: a label would rather sit clear of *every* line, its own
    included. Only when no such place exists does it fall back to sitting
    beside its own line, which is what a flow label normally does.
    """
    w, h = est_text_size(text, wrap_w)
    fallback, fallback_hits = None, None
    for include_own in ((True, False) if own_poly is not None else (False,)):
        for cx, top in cands:
            box = label_rect(cx, top, w, h)
            # a label never leaves the diagram: a note hanging off the right edge
            # of the last pool would be cut off in the PNG
            if box['x'] < X0 - 20 or box['x'] + box['w'] > 20 + pool_w - 10:
                continue
            hits = sum(1 for o in placed
                       if not (o.get('id') in skip_ids) and rect_hit(box, o))
            hits += sum(1 for poly in avoid_polys if poly_hits_rect(poly, box))
            if include_own and poly_hits_rect(own_poly, box):
                hits += 1
            if hits == 0:
                placed.append(dict(box, id=owner_id))
                return box
            if fallback_hits is None or hits < fallback_hits:
                fallback, fallback_hits = box, hits
    label_problems.append('%s: no clean spot for the label %r (%d box(es)/line(s) touched)'
                          % (owner_id, text, fallback_hits if fallback_hits is not None else -1))
    placed.append(dict(fallback or label_rect(0, 0, w, h), id=owner_id))
    return fallback or label_rect(0, 0, w, h)

# boundary events: below the host, clear of the host's own box
for n in nodes.values():
    if n['type'] != 'boundaryEvent':
        continue
    host = nodes[n['host']]
    w = 130.0
    cands = [(host['x'] + 40, host['y'] + host['h'] + 6),
             (host['x'] + host['w'] - 40, host['y'] + host['h'] + 6),
             (host['x'] + 40, host['y'] - 34),
             (n['x'] + 40, n['y'] + n['h'] + 6)]
    cands += grid_candidates(host['x'] + 40, host['y'] + host['h'] + 6)
    cands += grid_candidates(host['x'] + host['w'] - 40, host['y'] + host['h'] + 6)
    labels_di['label_' + n['id']] = (place_label(n['name'], cands, w, 'label_' + n['id'],
                                                  skip_ids={n['id'], host['id']},
                                                  avoid_polys=list(edge_polys.values())),
                                     'boundary', n['id'])

# gateways and events: below the element, else above it, else beside it
for n in nodes.values():
    if n['type'] not in GW_TYPES and n['type'] not in CONTROL:
        continue
    if n['type'] == 'boundaryEvent':
        continue
    w = 130.0
    eh = est_text_size(n['name'], w)[1]
    cands = [(n['x'] + n['w'] / 2, n['y'] + n['h'] + 2),
             (n['x'] + n['w'] / 2, n['y'] - eh - 4),
             (n['x'] + n['w'] / 2, n['y'] + n['h'] + 44),
             (n['x'] + n['w'] / 2, n['y'] - eh - 48),
             (n['x'] - 8 - 76, n['y'] + n['h'] / 2 - eh / 2),
             (n['x'] + n['w'] + 8 + 76, n['y'] + n['h'] / 2 - eh / 2)]
    cands += grid_candidates(n['x'] + n['w'] / 2, n['y'] + n['h'] + 2)
    cands += grid_candidates(n['x'] + n['w'] / 2, n['y'] - eh - 4)
    labels_di['label_' + n['id']] = (place_label(n['name'], cands, w, 'label_' + n['id'],
                                                  skip_ids={n['id']},
                                                  avoid_polys=list(edge_polys.values())),
                                     'element', n['id'])

# flow labels: the middle of each segment, above/below or left/right of it, and
# finally just above or below the source box
flow_labels = {}
for eid, kind, s, t, text, hint in EDGES:
    if not text:
        continue
    wps = route(nodes[s], nodes[t], hint, kind)
    src, tgt = nodes[s], nodes[t]
    cands = []
    segs = sorted(zip(wps, wps[1:]),
                  key=lambda sg: -((sg[1][0] - sg[0][0]) ** 2 + (sg[1][1] - sg[0][1]) ** 2))
    for (x1, y1), (x2, y2) in segs:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        if abs(y2 - y1) < 2:
            cands.append((mx, y1 - 20))
            cands.append((mx, y1 + 6))
        elif abs(x2 - x1) < 2:
            cands.append((x1 + 6 + 130, my - 10))
            cands.append((x1 - 6 - 130, my - 10))
    cands += [(src['x'] + src['w'] / 2, src['y'] - 20),
              (src['x'] + src['w'] / 2, src['y'] + src['h'] + 6),
              (tgt['x'] + tgt['w'] / 2, tgt['y'] - 20),
              (tgt['x'] + tgt['w'] / 2, tgt['y'] + tgt['h'] + 6)]
    cands += grid_candidates(src['x'] + src['w'] / 2, src['y'] + src['h'] + 6)
    cands += grid_candidates(tgt['x'] + tgt['w'] / 2, tgt['y'] + tgt['h'] + 6)
    flow_labels[eid] = place_label(text, cands, 150.0, eid,
                                   avoid_polys=[p for k, p in edge_polys.items() if k != eid],
                                   own_poly=edge_polys[eid])
    labels_di[eid] = (flow_labels[eid], 'flow', eid)


# a label must not be printed across a line. For an element's own label every
# line counts, its own edges included: a gateway label under a gateway is
# crossed by the very flow that leaves its bottom. A flow's own line is the
# exception -- a flow label sitting beside its line is what a flow label is.
for lid, (lr, lkind, owner) in labels_di.items():
    for eid, poly in edge_polys.items():
        if lkind == 'flow' and eid == owner:
            continue
        if poly_hits_rect(poly, lr):
            label_problems.append('%s (label of %s) is crossed by %s'
                                  % (lid, owner, eid))

# informational: a flow label may sit beside its own line (that is what a flow
# label is); these are the ones where no place clear of every line existed
own_line_labels = [lid for lid, (lr, lkind, owner) in labels_di.items()
                   if lkind == 'flow' and poly_hits_rect(edge_polys[owner], lr)]

# ---------------------------------------------------------------- self-checks
def point_inside(px, py, n, pad=3):
    return (n['x'] + pad < px < n['x'] + n['w'] - pad
            and n['y'] + pad < py < n['y'] + n['h'] - pad)

def segment_samples(wps, steps=120):
    pts = []
    for (x1, y1), (x2, y2) in zip(wps, wps[1:]):
        for i in range(steps + 1):
            t = i / steps
            pts.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
    return pts

def overlaps(p, q):
    return (p['x'] < q['x'] + q['w'] and q['x'] < p['x'] + p['w']
            and p['y'] < q['y'] + q['h'] and q['y'] < p['y'] + p['h'])

problems = []
overlap_problems = []
for aid, a in anns.items():
    for nid, n in boxes():
        if nid != aid and overlaps(a, n):
            overlap_problems.append('annotation %s overlaps %s' % (aid, nid))
problems += overlap_problems
edge_problems = []
for eid, kind, s, t, label, hint in EDGES:
    wps = route(nodes[s], nodes[t], hint, kind)
    # annotations count here too: the template skips them, but a line printed
    # across a note's text is exactly as unreadable as a line across a box
    for nid, n in boxes():
        if nid in (s, t):
            continue
        for px, py in segment_samples(wps):
            if point_inside(px, py, n):
                edge_problems.append('%s (%s->%s) crosses %s at (%.0f,%.0f)'
                                     % (eid, s, t, nid, px, py))
                break
problems += edge_problems

# ---------------------------------------------------------------- emit XML
B = '{http://www.omg.org/spec/BPMN/20100524/MODEL}'
BD = '{http://www.omg.org/spec/BPMN/20100524/DI}'
DC = '{http://www.omg.org/spec/DD/20100524/DC}'
DI = '{http://www.omg.org/spec/DD/20100524/DI}'
BIOC = '{http://bpmn.io/schema/bpmn/biocolor/1.0}'
for pfx, uri in (('bpmn', B[1:-1]), ('bpmndi', BD[1:-1]), ('dc', DC[1:-1]),
                 ('di', DI[1:-1]), ('bioc', BIOC[1:-1])):
    ET.register_namespace(pfx, uri)

defs = ET.Element(B + 'definitions', {'id': 'Definitions_1',
                                      'targetNamespace': 'https://example.invalid/bpmn'})
collab = ET.SubElement(defs, B + 'collaboration', {'id': 'Collaboration_1'})
proc = {p: 'Proc_' + p for p in POOLS}
for p in POOLS:
    ET.SubElement(collab, B + 'participant',
                  {'id': 'Part_' + p, 'name': POOL_TITLE[p], 'processRef': proc[p]})
for eid, kind, s, t, label, hint in EDGES:
    if kind != 'msg':
        continue
    at = {'id': eid, 'sourceRef': s, 'targetRef': t}
    if label:
        at['name'] = label
    ET.SubElement(collab, B + 'messageFlow', at)

flow_io = {}
for eid, kind, s, t, label, hint in EDGES:
    if kind != 'seq':
        continue
    flow_io.setdefault(s, []).append(('out', eid))
    flow_io.setdefault(t, []).append(('in', eid))

for p in POOLS:
    pr = ET.SubElement(defs, B + 'process', {'id': proc[p], 'isExecutable': 'false'})
    ls = ET.SubElement(pr, B + 'laneSet', {'id': 'LaneSet_' + p})
    for lid, lp, title in LANES:
        if lp != p:
            continue
        lane = ET.SubElement(ls, B + 'lane', {'id': lid, 'name': title})
        for nid, n in nodes.items():
            if n['lane'] == lid and n['type'] != 'boundaryEvent':
                ET.SubElement(lane, B + 'flowNodeRef').text = nid
    for aid, a in anns.items():
        if a['pool'] == p:
            ta = ET.SubElement(pr, B + 'textAnnotation', {'id': aid})
            ET.SubElement(ta, B + 'text').text = a['text']
    for nid, n in nodes.items():
        if n['pool'] != p:
            continue
        el = ET.SubElement(pr, B + n['type'], {'id': nid, 'name': n['name']})
        if n['type'] == 'boundaryEvent':
            el.set('attachedToRef', n['host'])
            el.set('cancelActivity', 'true' if n['ev'] != 'error' else 'true')
            ET.SubElement(el, B + ('timerEventDefinition' if n['ev'] == 'timer'
                                   else 'errorEventDefinition'))
        for direction, eid in flow_io.get(nid, []):
            ET.SubElement(el, B + ('incoming' if direction == 'in' else 'outgoing')).text = eid
    for eid, kind, s, t, label, hint in EDGES:
        if kind != 'seq' or nodes[s]['pool'] != p:
            continue
        at = {'id': eid, 'sourceRef': s, 'targetRef': t}
        if label:
            at['name'] = label
        ET.SubElement(pr, B + 'sequenceFlow', at)

dgm = ET.SubElement(defs, BD + 'BPMNDiagram', {'id': 'BPMNDiagram_1'})
plane = ET.SubElement(dgm, BD + 'BPMNPlane', {'id': 'Plane_1', 'bpmnElement': 'Collaboration_1'})
for p in POOLS:
    sh = ET.SubElement(plane, BD + 'BPMNShape',
                       {'id': 'Part_%s_di' % p, 'bpmnElement': 'Part_' + p, 'isHorizontal': 'true'})
    ET.SubElement(sh, DC + 'Bounds', {'x': '20', 'y': str(pool_y[p]),
                                      'width': str(pool_w), 'height': str(pool_h[p])})
    for lid, lp, _ in LANES:
        if lp != p:
            continue
        sh = ET.SubElement(plane, BD + 'BPMNShape',
                           {'id': lid + '_di', 'bpmnElement': lid, 'isHorizontal': 'true'})
        ET.SubElement(sh, DC + 'Bounds', {'x': '60', 'y': str(lane_y[lid]),
                                          'width': str(pool_w - 40), 'height': str(lane_h[lid])})
for nid, n in nodes.items():
    at = {'id': nid + '_di', 'bpmnElement': nid}
    if nid in NOT_EXERCISED:
        # namespaced, not a literal 'bioc:fill' key: a literal prefix would be
        # written without the xmlns:bioc declaration and the document would not
        # even parse as XML
        at[BIOC + 'fill'] = NOT_EXERCISED_FILL
        at[BIOC + 'stroke'] = NOT_EXERCISED_STROKE
    sh = ET.SubElement(plane, BD + 'BPMNShape', at)
    ET.SubElement(sh, DC + 'Bounds', {'x': str(n['x']), 'y': str(n['y']),
                                      'width': str(n['w']), 'height': str(n['h'])})
    # events and gateways need explicit label bounds, or bpmn-js wraps the name
    # to the element's own width and a 36 px circle becomes one word per line;
    # the bounds were placed against every box on the canvas (see the label
    # section above), so no name is printed on top of a shape
    lab = labels_di.get('label_' + nid)
    if lab:
        lr, _kind, _owner = lab
        w_emit = max(100.0, lr['w'])
        x_emit = lr['x'] + lr['w'] / 2 - w_emit / 2
        lb = ET.SubElement(sh, BD + 'BPMNLabel')
        ET.SubElement(lb, DC + 'Bounds', {'x': str(round(x_emit, 1)), 'y': str(round(lr['y'], 1)),
                                         'width': str(round(w_emit, 1)),
                                         'height': str(round(max(lr['h'], 30.0), 1))})
for aid, a in anns.items():
    sh = ET.SubElement(plane, BD + 'BPMNShape', {'id': aid + '_di', 'bpmnElement': aid})
    ET.SubElement(sh, DC + 'Bounds', {'x': str(a['x']), 'y': str(a['y']),
                                      'width': str(a['w']), 'height': str(a['h'])})
for eid, kind, s, t, label, hint in EDGES:
    ed = ET.SubElement(plane, BD + 'BPMNEdge', {'id': eid + '_di', 'bpmnElement': eid})
    for (px, py) in route(nodes[s], nodes[t], hint, kind):
        ET.SubElement(ed, DI + 'waypoint', {'x': str(round(px, 1)), 'y': str(round(py, 1))})
    lab = labels_di.get(eid)
    if lab:
        lr, _kind, _owner = lab
        # keep the CENTRE: bpmn-js re-centres the label on the declared bounds,
        # so widening the box without moving x would shift the label sideways
        w_emit = max(lr['w'], 120.0)
        x_emit = lr['x'] + lr['w'] / 2 - w_emit / 2
        lb = ET.SubElement(ed, BD + 'BPMNLabel')
        ET.SubElement(lb, DC + 'Bounds', {'x': str(round(x_emit, 1)), 'y': str(round(lr['y'], 1)),
                                          'width': str(round(w_emit, 1)),
                                          'height': str(round(max(lr['h'], 30.0), 1))})

xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(defs, encoding='unicode')
with open(OUT_BPMN, 'w', encoding='utf-8') as fh:
    fh.write(xml + '\n')

# the canvas, for the render page and the viewer's fit button
canvas_w = max([a['x'] + a['w'] for a in anns.values()]
               + [n['x'] + n['w'] for n in nodes.values()]
               + [lr['x'] + lr['w'] for lr, _, _ in labels_di.values()]
               + [max(p[0] for p in route(nodes[s], nodes[t], hint, kind))
                  for _, kind, s, t, _, hint in EDGES]
               + [20 + pool_w]) + 60
canvas_h = max([a['y'] + a['h'] for a in anns.values()]
               + [n['y'] + n['h'] for n in nodes.values()]
               + [lr['y'] + lr['h'] for lr, _, _ in labels_di.values()]
               + [max(p[1] for p in route(nodes[s], nodes[t], hint, kind))
                  for _, kind, s, t, _, hint in EDGES]
               + [pool_y[p] + pool_h[p] for p in POOLS]) + 60

# ---------------------------------------------------------------- histogram
def count(types):
    return {t: sum(1 for n in nodes.values() if n['type'] == t) for t in types}

hist = {
    'participants (pools)': len(POOLS),
    'lanes': len(LANES),
    'events (start)': count(('startEvent',))['startEvent'],
    'events (end)': count(('endEvent',))['endEvent'],
    'events (boundary)': count(('boundaryEvent',))['boundaryEvent'],
    'tasks': count(('task',))['task'],
    'tasks (service)': count(('serviceTask',))['serviceTask'],
    'tasks (user)': count(('userTask',))['userTask'],
    'tasks (send)': count(('sendTask',))['sendTask'],
    'tasks (receive)': count(('receiveTask',))['receiveTask'],
    'gateways (exclusive)': count(('exclusiveGateway',))['exclusiveGateway'],
    'gateways (parallel)': count(('parallelGateway',))['parallelGateway'],
    'annotations': len(anns),
    'sequence flows': sum(1 for e in EDGES if e[1] == 'seq'),
    'message flows': sum(1 for e in EDGES if e[1] == 'msg'),
}
hist['flow nodes total'] = sum(v for k, v in hist.items() if k.startswith(('events', 'tasks', 'gateways')))
hist['elements total (nodes + annotations)'] = hist['flow nodes total'] + hist['annotations']
hist['amber (not exercised end to end)'] = len(NOT_EXERCISED)

# ---------------------------------------------------------------- viewer
def ensure_vendor():
    """Copy the bpmn-js dist assets into vendor/ when they are not there yet."""
    want = {
        'bpmn-navigated-viewer.production.min.js': 'bpmn-navigated-viewer.production.min.js',
        'diagram-js.css': 'assets/diagram-js.css',
        'bpmn-js.css': 'assets/bpmn-js.css',
        'bpmn-codes.css': 'assets/bpmn-font/css/bpmn-codes.css',
        'bpmn.woff2': 'assets/bpmn-font/font/bpmn.woff2',
    }
    missing = [n for n in want if not os.path.exists(os.path.join(VENDOR, n))]
    if not missing:
        return 'present'
    os.makedirs(VENDOR, exist_ok=True)
    for src in VENDOR_SOURCES:
        if all(os.path.exists(os.path.join(src, rel)) for rel in want.values()):
            for name, rel in want.items():
                shutil.copyfile(os.path.join(src, rel), os.path.join(VENDOR, name))
            return 'copied from %s' % src
    sys.stderr.write('vendor/ is incomplete (%s) and no bpmn-js dist was found in %s\n'
                     % (', '.join(missing), ', '.join(VENDOR_SOURCES)))
    sys.exit(2)

vendor_state = ensure_vendor()

def read(path, mode='r'):
    with open(path, mode, **({} if 'b' in mode else {'encoding': 'utf-8'})) as fh:
        return fh.read()

font_b64 = base64.b64encode(read(os.path.join(VENDOR, 'bpmn.woff2'), 'rb')).decode('ascii')
icon_css = read(os.path.join(VENDOR, 'bpmn-codes.css'))
diagram_css = read(os.path.join(VENDOR, 'diagram-js.css'))
bpmnjs_css = read(os.path.join(VENDOR, 'bpmn-js.css'))
umd = read(os.path.join(VENDOR, 'bpmn-navigated-viewer.production.min.js'))

FONT_CSS = ("@charset \"utf-8\";\n"
            "@font-face { font-family: 'bpmn'; font-style: normal; font-weight: normal;\n"
            "  src: url(data:font/woff2;base64,%s) format('woff2'); }\n" % font_b64)

# ---------------------------------------------------------------- evidence
# The proof panel reads the module's own evidence at build time, so the numbers
# the viewer shows are the numbers in signer/evidence/ and not a copy that goes
# stale the moment the module's suite grows.
EVIDENCE = os.path.normpath(os.path.join(HERE, '..', '..', 'evidence'))

def from_evidence(filename, pattern, fallback):
    path = os.path.join(EVIDENCE, filename)
    try:
        with open(path, encoding='utf-8') as fh:
            text = fh.read()
    except OSError:
        return fallback + ' (signer/evidence not readable from this build)'
    match = re.search(pattern, text)
    return match.group(0) if match else fallback

SUITE = from_evidence('record.md',
                      r'\*\*\d+ pass, \d+ fail, \d+ expectations, \d+ files\*\*',
                      'the suite counts are not stated').replace('**', '')
FALSIFY = from_evidence('02-invariant-falsification.txt',
                        r'\d+ mutation\(s\) applied, \d+ falsification failure\(s\)',
                        'the falsification counts are not stated')

def zero_match_mutations():
    """Mutations whose command matched no test: their verdict is a name
    mismatch, not a failing assertion, and saying so is the honest thing to do."""
    path = os.path.join(EVIDENCE, '02-invariant-falsification.txt')
    try:
        with open(path, encoding='utf-8') as fh:
            text = fh.read()
    except OSError:
        return []
    out = []
    for block in text.split('======'):
        if 'matched 0 tests' in block:
            head = [l for l in block.splitlines() if l.strip()]
            if head:
                out.append(head[0].strip())
    return out

ZERO_MATCH = zero_match_mutations()
MUTATION_NOTE = ('No mutation command in the evidence this build read matched no test.'
                 if not ZERO_MATCH else
                 'In the evidence this build read, these mutation commands matched 0 tests, so the '
                 'verdict printed beside them is a name mismatch and not a failing assertion: '
                 + '; '.join(ZERO_MATCH) + '.')

# element inventory lines for the panel
INVENTORY = '\n'.join(
    '<div class="inv"><span>%s</span><b>%s</b></div>' % (k, v)
    for k, v in [(k, hist[k]) for k in sorted(hist, key=lambda k: (k != 'participants (pools)', k))])

PANELS = """
<section>
  <h2>The signer module&rsquo;s session lifecycle</h2>
  <p>A BPMN 2.0 collaboration of what <code>signer/</code> does when a host composes a session on it:
     who takes part, which branch decides what, and what happens when a branch refuses.</p>
  <p class="warn"><b>Read this as a first implementation, not as a running system.</b>
     Nothing imports this module, no relay is ever contacted, the NIP-46 lanes answer from an
     in-process emulator, and no host adapter ships. Amber elements are the legs that have never
     run end to end.</p>
</section>

<section>
  <h2>How to read the canvas</h2>
  <ul>
    <li><b>Solid line</b> — a sequence flow: the next step inside one participant.</li>
    <li><b>Dashed line</b> — a message flow: something crossing between two participants
        (or between the module and a port the consumer implements).</li>
    <li><b>Amber shape</b> — specified and drawn, but not exercised end to end in this build.</li>
    <li><b>&ldquo;NOT A PARTICIPANT&rdquo; pools</b> — the relay and the injected ports. They are drawn
        separately on purpose: folding infrastructure into a participant&rsquo;s lane hides exactly
        where the failure modes live.</li>
    <li><b>Three participants</b> — the consumer (hypothetical), the signer module (the subject),
        and the remote signer (real in BPMN terms, hypothetical in fact).</li>
  </ul>
</section>

<section>
  <h2>The five invariants, and how each is proven</h2>
  <p class="note">The module&rsquo;s own suite, as recorded in <code>signer/evidence/</code> when this
     build ran: <b>__SUITE__</b> (<code>cd signer/ts &amp;&amp; bun test</code>), and the
     falsification run reports <b>__FALSIFY__</b>. Each invariant below names the cases that carry it
     and the mutation that breaks it.</p>
  <div class="inv-block">
    <h3>I1 — the connect secret is validated before binding</h3>
    <p>An unknown remote signer is never bound from a bare <code>ack</code>. The strict-bind transport
       decrypts every inbound event and drops a top-level <code>{ result: "ack" }</code> with no request
       id before the library&rsquo;s lax bind can see it.</p>
    <p class="proof">Proven by <code>invariants.test.ts</code>: &ldquo;a bare "ack" never binds an unknown
       remote signer&rdquo;, &ldquo;a wrong connect secret never binds the remote signer&rdquo;, &ldquo;a
       validated connect-secret echo binds the remote signer&rdquo;, &ldquo;the bunker flow binds only a
       remote that accepts the connect secret&rdquo;. Falsified: the strict-bind drop removed &rarr; the named
       case fails. On the canvas: the bunker lane, and the <i>bare ack</i> row of the peer pool.</p>
  </div>
  <div class="inv-block">
    <h3>I2 — the remote signer is not the authenticated user</h3>
    <p>The remote-signer pubkey stays separate from the authenticated identity, which is learned only
       through <code>getPublicKey()</code> — never from the client key, never from a raw remote field.
       A session never becomes <code>active</code> without a resolved identity.</p>
    <p class="proof">Proven by <code>invariants.test.ts</code>: &ldquo;identity resolution is via
       getPublicKey() only — never clientPubkey (structural oracle)&rdquo;, &ldquo;behaviourally: a bound
       session resolves the user, not the client key nor the remote&rdquo;; and by
       <code>session.test.ts</code> &ldquo;a session never becomes active without a resolved identity&rdquo;.
       Falsified: the capability answering with <code>clientPubkey</code> &rarr; the named case
       fails. On the canvas: <i>Resolve the identity</i> and the <i>one session, identity resolved?</i>
       gateway.</p>
  </div>
  <div class="inv-block">
    <h3>I3 — a signed event is bound to the resolved identity</h3>
    <p>A returned event must verify cryptographically <b>and</b> satisfy
       <code>event.pubkey === getPublicKey()</code>. A valid signature from another key fails closed, and
       the assertion is applied once, in the attach path, so every lane crosses it.</p>
    <p class="proof">Proven by <code>invariants.test.ts</code>: &ldquo;signEvent fails closed when the
       returned event pubkey differs&hellip;&rdquo;, &ldquo;&hellip;when the signature does not verify, even if
       the pubkey matches&rdquo;, &ldquo;signEvent returns the event when identity and signature agree&rdquo;,
       &ldquo;the NIP-46 lane arrives at the same assertion&hellip;&rdquo;, &ldquo;the session-less
       construct-on-key entry is identity-bound too&rdquo;. Falsified: the pubkey comparison removed &rarr; the
       named case fails. On the canvas: <i>verifies and same pubkey?</i> and its refusal.</p>
  </div>
  <div class="inv-block">
    <h3>I4 — NIP-44 is capability-gated, never synthesised locally</h3>
    <p>Two gates compose and both must open: the signer must provide the scheme, and the composer&rsquo;s
       allow-list must permit it. An empty or absent allow-list yields <b>no</b> encryption at all, and
       <code>encrypt</code>/<code>decrypt</code> refuse rather than falling back to a key the user never
       exposed.</p>
    <p class="proof">Proven by <code>invariants.test.ts</code>: &ldquo;leaves nip04 and nip44 absent when the
       extension lacks them (fail closed)&rdquo;, &ldquo;an extension that exposes only half of nip44 offers no
       nip44 at all&rdquo;, &ldquo;present &hArr; the signer provides it, and the composer allow-list may only
       narrow&rdquo;, &ldquo;a locked NIP-49 signer rejects fast instead of hanging&hellip;&rdquo;; and by
       <code>session.test.ts</code> &ldquo;the composer allow-list gates the capability set — absent means
       refuse, never synthesise&rdquo;. Falsified: the allow-list mutation (the gate inverted &rarr; the named
       case fails). __MUTATION_NOTE__ The extension case is falsified as well: the extension-lane mutation
       synthesises a <code>nip44</code> the extension does not expose, and the named case fails on it
       (&ldquo;nip44&rdquo;: false &rarr; true) &mdash; see <code>evidence/02-invariant-falsification.txt</code>,
       mutation 4.</p>
  </div>
  <div class="inv-block">
    <h3>I5 — session secrets are never silently plaintext</h3>
    <p>A persisted session is a PBKDF2&ndash;AES-GCM envelope or it is not persisted at all. A legacy
       plaintext record is read <b>once</b> and either migrated or discarded with an intentional re-login.
       The iteration count is attacker-writable storage, so an envelope below the accepted floor is rejected
       before any key derivation.</p>
    <p class="proof">Proven by <code>vault.test.ts</code> (&ldquo;iteration-downgrade tamper: lowered
       iterations are rejected even with the CORRECT passphrase&rdquo;, &ldquo;a mutation-time ownership guard
       can cancel a completed wrap before vault storage&rdquo;, &ldquo;a mutation-time ownership guard cancels
       migration before the vault write or the plaintext deletion&rdquo;), by <code>invariants.test.ts</code>
       (&ldquo;a legacy plaintext record is discarded by default&hellip;&rdquo;, &ldquo;&hellip;migrates when
       configured, deleting the plaintext&rdquo;, &ldquo;the token a session persists is the encrypted session
       token, never the key&rdquo;), and by <code>session.test.ts</code> (&ldquo;a bunker session is written
       encrypted, and endSession clears it&rdquo;, &ldquo;without a passphrase source nothing is persisted —
       there is no plaintext fallback&rdquo;). Falsified: the iteration floor removed (a downgraded envelope
       unlocks with the right passphrase), and the raw session token persisted in place of the envelope.
       On the canvas: the vault lane.</p>
  </div>
</section>

<section>
  <h2>Documented failure modes (each one a typed refusal)</h2>
  <div class="inv"><span>A lane the host cannot offer — extension absent, or a NIP-46 lane without an
    injected transport or clock</span><b>LaneUnavailableError · TransportRequiredError · ClockRequiredError</b></div>
  <p class="src">The lane is refused, not degraded: <code>session.test.ts</code> &ldquo;a lane the host cannot
     offer refuses instead of degrading&rdquo;, &ldquo;the client-initiated lane refuses without a sink for the
     connect URI&rdquo;; <code>nip46.test.ts</code> &ldquo;a NIP-46 lane without an injected transport refuses
     instead of reaching for a host default&rdquo; and the same for the clock.</p>
  <div class="inv"><span>An identity that will not resolve</span><b>IdentityUnresolvedError /
    InvalidTransitionError</b></div>
  <p class="src">A session never becomes <code>active</code> without a resolved identity, and never while
     another capability is attached (<code>SessionAttachedError</code>).
     <code>session.test.ts</code>: &ldquo;a session never becomes active without a resolved identity&rdquo;,
     &ldquo;a second session is refused while one is attached, and the first is untouched&rdquo;.</p>
  <div class="inv"><span>A signed event from a different key, or one that does not verify</span>
    <b>IdentityMismatchError</b></div>
  <p class="src">Fail closed — see I3. The same assertion covers the session-less
     <code>createSignerFromKey</code> entry.</p>
  <div class="inv"><span>Encryption the signer does not provide, or the composer did not allow</span>
    <b>CapabilityUnavailableError</b></div>
  <p class="src">See I4. An allow-list that is empty or absent exposes nothing at all.</p>
  <div class="inv"><span>A locked NIP-49 signer</span><b>PasswordSignerLockedError</b></div>
  <p class="src">The library deadlocks on a call while locked (it awaits a deferred nothing resolves), so every
     capability call is gated and rejects fast. <code>invariants.test.ts</code> &ldquo;a locked NIP-49 signer
     rejects fast instead of hanging on a never-resolved unlock&rdquo;.</p>
  <div class="inv"><span>A silent remote: no answer to an RPC</span><b>Nip46RpcTimeoutError</b></div>
  <p class="src">Every RPC is bounded (30 s per RPC by default) by the injected clock.
     <code>nip46.test.ts</code> &ldquo;a silent remote rejects with a lane-specific error instead of hanging
     forever&rdquo;.</p>
  <div class="inv"><span>An unapproved client-initiated connect</span><b>Nip46RpcTimeoutError on the connect
    deadline</b></div>
  <p class="src">The connect / auth-challenge phase gets a longer budget (5 min by default) because it waits on
     a human. <code>nip46.test.ts</code> &ldquo;an unapproved client-initiated lane ends in a deadline refusal,
     and the session fails closed&rdquo;.</p>
  <div class="inv"><span>A wrong passphrase, tampered ciphertext, or an envelope below the iteration floor</span>
    <b>SessionVaultError</b></div>
  <p class="src">Wrong passphrase and tampered ciphertext both surface at the AES-GCM tag, without leaking which
     check failed; the floor is checked <i>before</i> any derivation.
     <code>vault.test.ts</code>: &ldquo;wrong passphrase fails closed&rdquo;, &ldquo;tampered ciphertext fails
     closed (AES-GCM auth tag)&rdquo;, &ldquo;iteration-downgrade tamper&hellip;&rdquo;.</p>
  <div class="inv"><span>A legacy plaintext record with the default policy</span><b>SessionVaultError — an
    intentional re-login</b></div>
  <p class="src">Read once, then discarded: never silently retained. With
     <code>restoreOnStart: 'migrate'</code> it is wrapped, and the plaintext keys are deleted only after the
     vault write succeeded. An unparseable <code>bunker://</code> URL migrates nothing and keeps the pair.</p>
  <div class="inv"><span>A mutation that lands while the guard is running (the session was replaced or ended
    mid-flight)</span><b>the guard throws; nothing is written</b></div>
  <p class="src">The guard runs synchronously immediately before the storage mutation, on both the save and the
     migrate path. <code>vault.test.ts</code>: &ldquo;a mutation-time ownership guard can cancel a completed wrap
     before vault storage&rdquo; and &ldquo;&hellip;cancels migration before the vault write or the plaintext
     deletion&rdquo; — the vault key is absent and the plaintext pair is still there.</p>
  <div class="inv"><span>A storage write that fails</span><b>the lane fails; the session lands in
    <code>failed</code></b></div>
  <p class="src"><b>Specified, not exercised.</b> <code>startSession</code> runs the persist inside the same
     guard as the lane, so a rejecting <code>setItem</code> fails the lane and nothing is half-attached — but no
     test drives a rejecting storage write. The nearest evidence is the guard-cancellation case above. This is
     the amber branch on the canvas.</p>
  <div class="inv"><span>A transition the machine does not allow — for instance a new lane started while the
    session is <code>locked</code></span><b>InvalidTransitionError</b></div>
  <p class="src"><code>session.test.ts</code> &ldquo;a vaulted record parks in locked without a passphrase, and
     the machine refuses a new lane there&rdquo;. Unlock or end first.</p>
  <div class="inv"><span>Ending a session vs detaching a signer</span><b>the record is the difference</b></div>
  <p class="src"><code>endSession()</code> runs the teardown <i>and</i> clears the persisted record;
     <code>detachSigner()</code> runs the teardown and leaves the record in place — that is deliberate, and it
     is why the canvas has both, one row apart.</p>
  <div class="inv"><span>No storage port, no crypto port, or no passphrase source</span><b>nothing is
    persisted at all</b></div>
  <p class="src">Not an error — a policy with no plaintext fallback.
     <code>session.test.ts</code> &ldquo;without a passphrase source nothing is persisted — there is no
     plaintext fallback&rdquo;.</p>
  <div class="inv"><span>A teardown that throws</span><b>swallowed on purpose</b></div>
  <p class="src">Teardown is best-effort and idempotent: a failing unsubscribe must not leave a session that
     cannot be closed. <b>Specified, not directly tested</b> (the code path exists; no case drives a throwing
     teardown).</p>
</section>

<section>
  <h2>Specified, but not yet exercised — and never drawn as done</h2>
  <ul>
    <li><b>No relay.</b> The NIP-46 lanes run against the in-process emulator in
        <code>ts/harness.ts</code>. The relay pool and both transport rows are amber: nothing here proves a real
        relay round trip.</li>
    <li><b>No consumer.</b> Nothing imports this module. The consumer pool is a hypothesis, drawn so the
        contract&rsquo;s shape is readable — <code>availableLanes()</code> is how a surface is meant to decide,
        and the connect URI is delivered to a callback the caller supplies because it carries the secret.</li>
    <li><b>No host adapters.</b> No WebCrypto crypto port, no browser storage port, no relay transport ships
        with the module. The only implementations that exist are the harness&rsquo;s.</li>
    <li><b>No second implementation.</b> The spec exists so that a Rust / Flutter / Angular implementation can
        meet it; nothing here proves portability.</li>
    <li><b>Record-format compatibility is measured, with a scope.</b> The reference implementation&rsquo;s own
        vault code was run against this module&rsquo;s, in both directions, at 100&thinsp;000 iterations: the
        envelope, the KDF and the codec come back identical. What that does not cover is a record written by
        the market&rsquo;s <i>app</i> in a browser, or by an older market revision. The format is also still
        <i>open</i> as contract (the spec&rsquo;s <code>#8ed5d5</code>): a second implementation must match it or
        cannot read an existing record.</li>
    <li><b>One surface deviation.</b> The spec writes <code>attachSigner(capability, options)</code>; the
        implementation takes <code>attachSigner(capability, { lane })</code> — the settings are set once, when
        the session is created, so the second parameter carries only the lane label the snapshot reports.</li>
    <li><b>Still open in the spec.</b> Whether the client-initiated lane should persist an <i>unbound</i>
        session (<code>#55482f</code>), and whether the connect URI should be handed over as an opaque handle
        (<code>#994765</code>). The canvas draws what is specified today, not a decision that has not been
        made.</li>
  </ul>
</section>

<section>
  <h2>Explore three branches</h2>
  <p class="note">Each button opens the detail of one branch: what the code does, which test carries it, and
     what it refuses.</p>
  <div class="btns">
    <button data-target="ex-refuse">Why the capability gate refuses instead of degrading (I4)</button>
    <button data-target="ex-legacy">The legacy plaintext record and its mutation-time guard (I5)</button>
    <button data-target="ex-wait">The two waits, and why the timer sits on the receive task</button>
  </div>

  <div class="detail" id="ex-refuse">
    <h3>The capability gate — fail closed, never synthesise</h3>
    <p>On the canvas: <i>capabilities · allow-list &cap; signer</i> &rarr; <i>permitted and provided?</i> &rarr;
       either <i>Return the ciphertext</i> or <i>Refuse: capability unavailable</i>; and the sibling sign path
       through <i>Await the RPC answer</i> &rarr; <i>verifies and same pubkey?</i>.</p>
    <ol>
      <li><code>capabilities()</code> returns the intersection of what the signer actually provides
          (<code>hasNip44</code> / <code>hasNip04</code>) and what the composer allowed
          (<code>settings.capabilities</code>). An empty or absent allow-list exposes <b>nothing</b>.</li>
      <li><code>encrypt()</code> / <code>decrypt()</code> look the scheme up in that intersection. Absent means
          <code>CapabilityUnavailableError</code> — the operation refuses.</li>
      <li>The refusal is the invariant, not a bug: nothing in the module may compute NIP-44 from a key the user
          never exposed. A NIP-07 extension that lacks the method, or a remote that lacks the RPC, yields a
          capability without it.</li>
      <li>On a remote lane the delegation itself is bounded: every RPC is raced against the injected clock, so a
          silent remote ends in <code>Nip46RpcTimeoutError</code> instead of a promise that never settles.</li>
    </ol>
    <p class="proof">Carried by the tests named under I4 above; the allow-list half is falsified in the
       evidence. The extension-case mutation is the one to read carefully — see the note under I4.</p>
  </div>

  <div class="detail" id="ex-legacy">
    <h3>The legacy plaintext record, and the guard that can stop the write</h3>
    <p>On the canvas: <i>restoreSession · read the record</i> &rarr; <i>which record?</i> &rarr; the
       <i>a legacy plaintext record</i> branch &rarr; <i>migrate or re_login?</i> &rarr; the discard path or the
       migrate path &rarr; <i>ownership guard passes?</i> &rarr; <i>Write, then delete the plaintext</i> or
       <i>Abort · nothing written</i>.</p>
    <ol>
      <li><b>Read once.</b> The plaintext pair (<code>nostr_local_signer_key</code> +
          <code>nostr_connect_url</code>) is read a single time. Nothing keeps a copy.</li>
      <li><b>The default is re-login.</b> <code>restoreOnStart</code> defaults to <code>re_login</code>: the
          plaintext is discarded and the caller gets a <code>SessionVaultError</code> asking for an intentional
          re-login. Silent retention is not a default anywhere in the module.</li>
      <li><b>Migrate</b> wraps the pair into the PBKDF2&ndash;AES-GCM envelope, writes it, and only then deletes
          the two plaintext keys. An unparseable <code>bunker://</code> URL fails before the write and leaves the
          pair untouched.</li>
      <li><b>The guard.</b> Immediately before the storage mutation — on both the save and the migrate path — the
          vault calls a guard the composer owns (<code>assertMutationAllowed</code>). It is synchronous and runs
          after the wrap, so a mutation that lands mid-flight (a replaced or ended session) can cancel with
          <i>nothing</i> written: no vault key, plaintext intact. The canvas draws that as
          <i>Abort · nothing written</i>.</li>
      <li><b>The floor.</b> <code>iterations</code> is attacker-writable storage. An envelope below the accepted
          minimum (100 000, with 600 000 written) is rejected <b>before</b> any key derivation, so a downgraded
          envelope can never be brute-forced one iteration per guess.</li>
    </ol>
    <p class="proof"><code>vault.test.ts</code> carries steps 1&ndash;4 (happy path, refusal path, unparseable
       URL, and the two guard cases); <code>invariants.test.ts</code> and <code>session.test.ts</code> carry the
       session-level halves. Falsified by removing the iteration floor and by persisting the raw token.</p>
  </div>

  <div class="detail" id="ex-wait">
    <h3>The two waits, and why the timer hangs on the receive task</h3>
    <p>On the canvas: <i>Await the remote approval</i> with <i>connect deadline 5 min</i>, and <i>Await the RPC
       answer</i> with <i>RPC deadline 30 s</i> — both boundary events on a receive task.</p>
    <ol>
      <li><b>Why not a catch event?</b> In BPMN a boundary event may attach only to an activity. Attaching a
          timer to an <code>intermediateCatchEvent</code> is invalid even when a tool renders it, so each wait
          is modelled as a <b>receive task</b> and the timer attaches to that.</li>
      <li><b>Two budgets, deliberately.</b> The per-RPC deadline (30 s) guards sign / encrypt / decrypt. The
          connect phase gets 5 minutes because it waits on a human approving at the remote device — a 30 s
          deadline there would race the person and leak the subscription.</li>
      <li><b>What a timeout is.</b> Not a retry and not a fallback: the RPC rejects with
          <code>Nip46RpcTimeoutError</code>, the connect wait rejects on its deadline, and the session fails
          closed with <b>no capability attached</b>. A caller may start again from <code>idle</code>.</li>
      <li><b>Why the clock is a port.</b> The module holds no timer of its own: the deadlines come from the
          injected clock, so the whole thing can be driven deterministically — which is how the harness tests a
          5-minute timeout in milliseconds.</li>
    </ol>
    <p class="proof"><code>nip46.test.ts</code>: &ldquo;a silent remote rejects with a lane-specific error
       instead of hanging forever&rdquo;, &ldquo;resolves the operation result when it settles before the
       deadline&rdquo;, &ldquo;does not swallow an underlying rejection&rdquo;, &ldquo;a NIP-46 lane without an
       injected clock refuses&hellip;&rdquo;, &ldquo;an unapproved client-initiated lane ends in a deadline
       refusal, and the session fails closed&rdquo;.</p>
  </div>
</section>

<section>
  <h2>The build, and its checks</h2>
  <p class="note">Regenerate everything with <code>python3 build.py</code> in this directory:
     the <code>.bpmn</code>, this file, the full-resolution PNG and <code>checks.txt</code>.
     <code>checks.txt</code> holds the three layout self-checks, the headless import report and the
     element histograms. The diagram is built from <code>signer/signer.md</code> and
     <code>signer/ts/</code> as they stood when this build ran; the module&rsquo;s suite and its evidence
     keep growing in their own pass, and the counts above were read out of
     <code>signer/evidence/</code> at build time rather than copied in by hand.</p>
  __CHECKS__
  <h3>Element inventory (from the model tables)</h3>
  __INVENTORY__
</section>
"""

VIEWER_TMPL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>signer — the session lifecycle (BPMN 2.0)</title>
<style>
/* bpmn-js 18.30.1 — diagram-js.css, bpmn-js.css, and the bpmn icon font inlined */
__BPMN_CSS__
__FONT_CSS__
body { margin: 0; font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
       color: #16202b; background: #f4f6f8; }
#app { display: flex; height: 100vh; align-items: stretch; }
#stage { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
#bar { display: flex; gap: 8px; align-items: center; padding: 8px 10px; background: #fff;
       border-bottom: 1px solid #d7dde3; flex: 0 0 auto; }
#bar .spacer { flex: 1 1 auto; }
#bar button, .btns button { font: inherit; padding: 5px 12px; border: 1px solid #b9c2cb;
       background: #fff; border-radius: 4px; cursor: pointer; }
#bar button:hover, .btns button:hover { background: #eef2f6; }
#bar button.on { background: #16202b; color: #fff; border-color: #16202b; }
#bar .hint { color: #5b6672; font-size: 12px; }
#canvas { flex: 1 1 auto; min-height: 0; background: #fff; }
#panels { flex: 0 0 430px; overflow: auto; background: #fff; border-left: 1px solid #d7dde3;
       padding: 14px 16px 60px; }
#panels h2 { font-size: 15px; margin: 18px 0 6px; }
#panels h2:first-child { margin-top: 0; }
#panels h3 { font-size: 13.5px; margin: 14px 0 4px; }
#panels p, #panels li { margin: 6px 0; }
#panels section { border-bottom: 1px solid #e6eaee; padding-bottom: 10px; }
#panels code { background: #f2f5f8; padding: 0 3px; border-radius: 3px; font-size: 12.5px; }
.warn { background: #fff7ed; border-left: 3px solid #b45309; padding: 8px 10px; }
.note { color: #5b6672; font-size: 12.5px; }
.proof { color: #33414e; font-size: 12.5px; background: #f7fafc; border-left: 3px solid #9fb3c4;
         padding: 6px 9px; }
.inv-block { margin: 10px 0 14px; }
.inv { display: flex; gap: 10px; justify-content: space-between; border-top: 1px solid #eef1f4;
       padding: 5px 0; font-size: 13px; }
.inv span { flex: 1 1 auto; }
.inv b { flex: 0 0 auto; color: #8a3b12; font-weight: 600; text-align: right; }
.src { font-size: 12.5px; color: #4a5663; margin-left: 0; }
.btns { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
.detail { display: none; border-left: 3px solid #16202b; background: #f7fafc; padding: 6px 10px;
       margin: 10px 0; }
.detail.open { display: block; }
#panels ol { padding-left: 20px; }
/* the navigated viewer has no palette: hide it and the watermark regardless */
.djs-palette, .bjs-palette, .bjs-powered-by, .djs-powered-by { display: none !important; }
</style>
</head>
<body>
<div id="app">
  <div id="stage">
    <div id="bar">
      <button id="fit">Fit</button>
      <button id="z100">100%</button>
      <button id="z150">150%</button>
      <span class="hint" id="zoomhint"></span>
      <span class="spacer"></span>
      <span class="hint">wheel = zoom · drag = pan · opens at 100% on the first element</span>
    </div>
    <div id="canvas"></div>
  </div>
  <div id="panels">__PANELS__</div>
</div>
<script>__UMD__</script>
<script>
(function () {
  var XML = __XML__;
  var FIRST = __FIRST__;      // the first element, and where it sits on the canvas
  var viewer = new BpmnJS({ container: '#canvas' });
  window.__viewer = viewer;

  function setZoom(scale) {
    viewer.get('canvas').zoom(scale);
    document.getElementById('zoomhint').textContent = 'zoom ' + Math.round(scale * 100) + '%';
  }

  viewer.importXML(XML).then(function (result) {
    window.__importWarnings = (result && result.warnings) || [];
    window.__importErrors = [];
    try {
      viewer.get('canvas').zoom(1);
      scrollTo(FIRST);
    } catch (e) { window.__importErrors.push(String(e)); }
    window.__viewerReady = true;
  }).catch(function (err) {
    window.__importErrors = [String(err && err.message || err)];
    window.__viewerReady = true;
  });

  // open at 100% with the first element near the top-left of the viewport:
  // fit-to-viewport on a multi-thousand-pixel diagram makes the text unreadable
  function scrollTo(target) {
    var canvas = viewer.get('canvas');
    function near() {
      var node = document.querySelector('[data-element-id="' + target.id + '"]');
      if (!node) return null;
      var r = node.getBoundingClientRect();
      var box = document.getElementById('canvas').getBoundingClientRect();
      return { dx: r.left - box.left, dy: r.top - box.top };
    }
    canvas.scroll({ dx: -1e6, dy: -1e6 });
    var pos = near();
    // bring the element to (~40, ~40) inside the viewport, by trying both signs
    var want = { dx: 40 - pos.dx, dy: 40 - pos.dy };
    canvas.scroll(want);
    var after = near();
    if (Math.abs(after.dx - 40) > 8 || Math.abs(after.dy - 40) > 8) {
      canvas.scroll({ dx: -want.dx, dy: -want.dy });
      after = near();
    }
    window.__firstElementOffset = after;
  }

  document.getElementById('fit').onclick = function () { viewer.get('canvas').zoom('fit-viewport'); };
  document.getElementById('z100').onclick = function () { setZoom(1); };
  document.getElementById('z150').onclick = function () { setZoom(1.5); };

  Array.prototype.forEach.call(document.querySelectorAll('.btns button'), function (b) {
    b.onclick = function () {
      var el = document.getElementById(b.getAttribute('data-target'));
      var open = el.classList.contains('open');
      Array.prototype.forEach.call(document.querySelectorAll('.detail'), function (d) {
        d.classList.remove('open');
      });
      if (!open) el.classList.add('open');
    };
  });
})();
</script>
</body>
</html>
"""

RENDER_TMPL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>signer-session — full-resolution canvas</title>
<style>
__BPMN_CSS__
__FONT_CSS__
html, body { margin: 0; padding: 0; background: #fff; }
#canvas { width: __W__px; height: __H__px; }
</style>
</head>
<body>
<div id="canvas"></div>
<script>__UMD__</script>
<script>
(function () {
  var XML = __XML__;
  var viewer = new BpmnJS({ container: '#canvas' });
  viewer.importXML(XML).then(function (result) {
    window.__importWarnings = (result && result.warnings) || [];
    var canvas = viewer.get('canvas');
    canvas.zoom(1);
    var box = canvas.viewbox();
    if (Math.abs(box.x) > 0.5 || Math.abs(box.y) > 0.5) {
      canvas.scroll({ dx: box.x, dy: box.y });
      box = canvas.viewbox();
      if (Math.abs(box.x) > 0.5 || Math.abs(box.y) > 0.5) {
        canvas.scroll({ dx: -box.x, dy: -box.y });
        box = canvas.viewbox();
      }
    }
    window.__renderInfo = { w: __W__, h: __H__, scale: box.scale, viewbox: box };
    window.__renderReady = true;
  }).catch(function (err) {
    window.__renderError = String(err && err.message || err);
    window.__renderReady = true;
  });
})();
</script>
</body>
</html>
"""

first = nodes['C_boot']
viewer_html = (VIEWER_TMPL
               .replace('__BPMN_CSS__', diagram_css + '\n' + bpmnjs_css)
               .replace('__FONT_CSS__', FONT_CSS + '\n' + icon_css)
               .replace('__UMD__', umd)
               .replace('__XML__', json.dumps(xml))
               .replace('__FIRST__', json.dumps({'id': 'C_boot', 'x': first['x'], 'y': first['y']}))
               .replace('__PANELS__', PANELS.replace('__INVENTORY__', INVENTORY)
             .replace('__SUITE__', SUITE)
             .replace('__FALSIFY__', FALSIFY)
             .replace('__MUTATION_NOTE__', MUTATION_NOTE)))
with open(OUT_VIEWER, 'w', encoding='utf-8') as fh:
    fh.write(viewer_html)

render_html = (RENDER_TMPL
               .replace('__BPMN_CSS__', diagram_css + '\n' + bpmnjs_css)
               .replace('__FONT_CSS__', FONT_CSS + '\n' + icon_css)
               .replace('__UMD__', umd)
               .replace('__XML__', json.dumps(xml))
               .replace('__W__', str(int(canvas_w)))
               .replace('__H__', str(int(canvas_h))))
with open(OUT_RENDER, 'w', encoding='utf-8') as fh:
    fh.write(render_html)

# ---------------------------------------------------------------- verify
def run_verify():
    if os.environ.get('SIGNER_BPMN_SKIP_VERIFY') == '1':
        return 'skipped (SIGNER_BPMN_SKIP_VERIFY=1)\nIMPORT_WARNINGS=skipped\n'
    if not os.path.exists(VERIFY):
        return 'verify.cjs not found — skipped\n'
    env = dict(os.environ)
    env['CANVAS_W'] = str(int(canvas_w))
    env['CANVAS_H'] = str(int(canvas_h))
    try:
        out = subprocess.run(['node', VERIFY, OUT_VIEWER, OUT_RENDER, OUT_PNG],
                             cwd=HERE, env=env, capture_output=True, text=True, timeout=600)
    except Exception as exc:                                # noqa: BLE001
        return 'verify.cjs could not run: %s\n' % exc
    return (out.stdout or '') + ((out.stderr or '') if out.returncode else '')

import_ok, browser_hist = 'not run', []
verify_out = run_verify()
for line in verify_out.splitlines():
    if line.startswith('IMPORT_WARNINGS='):
        import_ok = line.split('=', 1)[1].strip()
    if line.startswith('HIST '):
        browser_hist.append(line[5:].strip())

checks = []
checks.append('signer — BPMN collaboration: build and checks')
checks.append('# command: python3 signer/visuals/bpmn/build.py')
checks.append('# bpmn-js: 18.30.1 (vendored UMD, %s)' % vendor_state)
checks.append('# canvas: %d x %d' % (int(canvas_w), int(canvas_h)))
checks.append('')
checks.append('== self-check 1 — annotation box vs node box ==')
checks.append('annotations: %d   nodes: %d   overlaps: %d'
              % (len(anns), len(nodes), len(overlap_problems)))
for p in overlap_problems:
    checks.append('  ' + p)
checks.append('== self-check 2 — edge polyline through a box ==')
checks.append('edges: %d (sequence %d, message %d)   crossings: %d'
              % (len(EDGES), hist['sequence flows'], hist['message flows'], len(edge_problems)))
for p in edge_problems:
    checks.append('  ' + p)
checks.append('== self-check 3 — no label is placed on a box (generator geometry) ==')
element_labels = [v for k, v in labels_di.items() if v[1] != 'flow']
checks.append('labels placed: %d element labels + %d flow labels   problems: %d'
              % (len(element_labels), len(flow_labels), len(label_problems)))
for p in label_problems:
    checks.append('  ' + p)
checks.append('')
checks.append('== annotation columns ==')
checks.append('message-flow source columns: %s' % sorted(msg_cols))
checks.append('cross-lane sequence-flow source columns: %s' % sorted(cross_cols))
checks.append('annotation columns: %s (none may be in the two sets above)'
              % sorted({a['col'] for a in anns.values()}))
checks.append('')
checks.append('== element histogram (from the model tables) ==')
for k in sorted(hist):
    checks.append('  %-38s %d' % (k, hist[k]))
checks.append('')
checks.append('== headless bpmn-js import (chromium, from file://) ==')
verify_lines = [l for l in verify_out.strip().splitlines() if not l.startswith('HIST ')]
checks.append('\n'.join(verify_lines) if verify_lines else 'verify.cjs produced no output')
checks.append('')
checks.append('== element histogram (from the bpmn-js element registry) ==')
checks.append('# the same numbers read back out of the importer, not out of the tables:')
checks.append('# 83 flow nodes + 14 annotations + 5 participants + 11 lanes + 1 collaboration')
checks.append('# + 27 message flows + 79 sequence flows + 97 label elements = 317.')
seen_hist = set()
for line in browser_hist:
    parts = line.split()
    if len(parts) == 2 and parts[0] not in seen_hist:
        seen_hist.add(parts[0])
        checks.append('  ' + line)
checks.append('')
checks.append('== verdict ==')
checks.append('self-check 1 (annotations): %d violation(s)' % len(overlap_problems))
checks.append('self-check 2 (edges):       %d violation(s)' % len(edge_problems))
checks.append('self-check 3 (labels):      %d violation(s)' % len(label_problems))
checks.append('import warnings:            %s' % import_ok)
checks.append('elements: model tables %d nodes + %d annotations; see the two histograms above'
              % (len(nodes), len(anns)))
checks.append('flow labels that had to sit beside their own line (allowed, to be read with the')
checks.append('render): %d%s' % (len(own_line_labels),
                                  (': ' + ', '.join(own_line_labels)) if own_line_labels else ''))
checks.append('amber (not exercised end to end): %s' % ', '.join(sorted(NOT_EXERCISED)))
checks_text = '\n'.join(checks) + '\n'
with open(OUT_CHECKS, 'w', encoding='utf-8') as fh:
    fh.write(checks_text)

# the viewer's "build and checks" block is filled in after verify.cjs has run,
# so the panel and checks.txt always report the same numbers
browser_total = 'n/a'
for line in browser_hist:
    parts = line.split()
    if len(parts) == 2 and parts[0] == 'total':
        browser_total = parts[1]
summary = (
    '<div class="inv"><span>self-check 1 — no annotation overlaps a node box</span><b>%d</b></div>'
    '<div class="inv"><span>self-check 2 — no edge polyline passes through a box</span><b>%d</b></div>'
    '<div class="inv"><span>headless bpmn-js import warnings</span><b>%s</b></div>'
    '<div class="inv"><span>elements in the registry (bpmn-js)</span><b>%s</b></div>'
    % (len(overlap_problems), len(edge_problems), import_ok, browser_total))
viewer_html = read(OUT_VIEWER).replace('__CHECKS__', summary)
with open(OUT_VIEWER, 'w', encoding='utf-8') as fh:
    fh.write(viewer_html)

print('nodes %d  annotations %d  edges %d' % (len(nodes), len(anns), len(EDGES)))
print('canvas %d x %d' % (int(canvas_w), int(canvas_h)))
print('problems: annotations %s / edges %s / labels %s'
      % (overlap_problems or 'none', edge_problems or 'none', label_problems or 'none'))
print('import warnings: %s' % import_ok)
print('wrote %s, %s, %s, %s, %s' % (OUT_BPMN, OUT_VIEWER, OUT_RENDER, OUT_PNG, OUT_CHECKS))
