# Friday R16 DKG composer review packet

Status: **source and one standalone artifact frozen for independent review;
not approved or run on a live host**.

The immutable source is commit
`1531a5175df9af7b441f20dfa079e9407974515d`, tree
`a3fa7398cf4749205007db46a3ae05ee46011f7f`. The only rebuilt executable is
`live-bin-friday-dkg-deployment-1531a51/plebeian-friday-dkg-deployment`,
SHA-256 `3aebe6a07236fba1d6082812e2b4f8b91c78d9cf0b51331c012af64b0b5558f6`.
The complete evidence is in `FRIDAY-R16-DKG-COMPOSER-BUILD-RECEIPT.json`.

## Durability contract

- `compose-manifest` derives the exact manifest and receipt before effects and
  binds their paths, hashes, manifest digest and four externally pinned host
  digests into a create-exclusive owner lock.
- Both files are built and fsynced in one 0700 staging directory. The receipt
  is promoted first with Linux `renameat2(RENAME_NOREPLACE)`; the manifest is
  promoted last as the commit marker. Neither destination is overwritten.
- Any failure preserves the lock, staging and/or exact promoted file. A second
  composer refuses a live lock.
- `recover-manifest` requires the same public coordinator, four enrollment
  records, ordered external pins and final paths. It authenticates the dead
  owner by boot ID, PID and process-start ticks, recomputes the exact binding,
  validates every existing byte, fills only a missing deterministic staged
  member, completes no-replace promotion, fsyncs the parent and then releases
  the lock.
- Changed pins or bytes, a live owner, unexpected staging entries, or a partial
  final pair without its staging directory fail closed and preserve state.
  Recovery never creates or replaces an identity.

Focused fixtures cover interruption after lock creation, after only the staged
manifest, after receipt-first promotion and after the final parent fsync. They
also cover a competing live writer and changed recovery inputs.

## Independent closure requested

Review the three pinned source files and reproduce:

```text
cd cashu-wrapper/ts
bun test demo-friday-dkg-deployment-tools.test.ts
bun run typecheck:friday
```

Confirm the receipt-first/manifest-last commit order, no-replace calls, exact
owner-death check, deterministic binding, byte validation, fsync boundaries and
absence of identity generation in the composer path. This packet does not
authorize copying the binary to V2, initializing the coordinator, composing a
live manifest, or starting DKG.

## Live acceptance driver status

The concrete live Comet confirmation and allowlisted host fault-control
adapters are still **missing**. `demo-friday-browser-acceptance-runner.ts`
remains an interface harness with fixture ports. It is not a live driver and
is not covered by this composer repair. No current artifact can truthfully run
the full browser-to-Comet fault exercise without those adapters.
