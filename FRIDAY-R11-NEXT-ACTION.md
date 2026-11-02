# Friday R11 next action

Status: **source-reviewed artifacts are built; exact-current trusted-HTTPS/FIPS
acceptance and deployment are not run or approved.**

Source is `f19eed797431981d81bfa3c5696858f84d2bfd3a`, tree
`96c3903a2a5bc7a4797284395174305b99a29e88`. R11 closes the two R10 review
blockers:

- FundingAbort prepare/status carries the browser's `fundingOperationId`
  through the service and recovery-only guard.
- Coco durably prepares or rejoins the exact threshold send before the app
  writes `coco_send_pending`. After that marker, execution is resume-only; a
  missing Coco operation fails closed and cannot create a replacement spend.

If post-swap proof validation fails, the exact Coco operation and app identity
remain durable and unavailable. R11 does not weaken NUT-12/DLEQ validation or
invent compensation for unverifiable proofs.

## Verified locally

- TypeScript Friday typecheck: PASS.
- Browser suite: 48/48, 194 assertions.
- Focused recovery/Coco/HTTP suite: 42/42, 151 assertions.
- Restricted Friday suite: 253/255, 999 assertions. The two failures were
  sandbox `EPERM` at OS-child IPC; the exact file passed 6/6, 38 assertions in
  the normal runner.
- Go `./...`: PASS. The shipped Go binary embeds source `f19eed7...`,
  `vcs.modified=false`, `GOAMD64=v1`.
- Rust participant: 21/21. Public inspector: build/test PASS, zero tests.
- Independent read-only review: no P0/P1; ACCEPT for an R11 source freeze.
- Committed and shipped browser bundles are byte-identical, SHA-256
  `6f36a9fee8efb6839befe17149bec955f318c528117045f06e87a6e2b17e99c8`.

These are compile, unit and static-review results. They are not a normally
trusted browser journey, real throwaway mint canary, privileged FIPS lab, or
four-VPS deployment result.

## Required next sequence

1. Owner unlocks the existing bounded SSH agent and confirms key fingerprint
   `SHA256:IGu9dXOSXw4JoPmwNjAgDRI2AY+zJil/haJGjKRYt34`; no password or private key
   is shared.
2. Run the already bounded metadata-only four-host and provider-firewall
   inventory with pinned host keys. Stop on any identity, permission or path
   ambiguity. Do not mutate hosts.
3. Render fresh per-host configs for a distinct Friday HTTPS origin. The
   Wednesday V1 origin and all Wednesday state remain excluded.
4. Before activation, prove every distinct Friday server database and anchor
   destination is fresh/empty and the distinct Friday browser origin has no
   prior Friday store. Preserve and refuse any pre-existing record; never clear
   or migrate it in place.
5. Obtain a fresh exact action-time approval for one reviewed current-artifact
   trusted-HTTPS/FIPS acceptance run. It must include the real fake mint's
   NUT-12/DLEQ canary and actual browser IndexedDB recovery boundary.
6. Only after that retained run and final review, request exact V2 certificate,
   firewall, fake-only persistent key placement, staging, service-start and
   bounded V4-unavailable approvals.

The existing SSH unlock and read-only command shape remains in
`FRIDAY-R10-NEXT-ACTION.md`; R11 does not broaden it. No R11 artifact may be
deployed from this document alone.

## Remaining limits

- Invalid post-swap DLEQ stays unavailable and recoverable by the same operation
  identity; no automatic refund is claimed for a malicious/misbehaving mint.
- The exact crash boundary after Coco prepare and before app-marker persistence
  is covered by idempotent components, not a retained real IndexedDB/mint crash
  run.
- Emergency unilateral timeout refund is not composed.
- Own raises remain disabled pending full-pool/stable-key continuity.
- A quote response lost before a durable operation ID remains unsupported.
- FundingAbort tolerates one signer absent before deterministic subset
  selection. A selected signer lost after root claim fails closed until the same
  signer returns.
- Fake sats only, one operator, jmcorgan/fips transport; no FIPS 140 or real-
  value claim.

Wednesday remains the tested fallback and must stay untouched.
