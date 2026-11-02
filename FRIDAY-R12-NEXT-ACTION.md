# Friday R12 next action

Status: **source-reviewed exact-current artifacts are built; inventory,
trusted-HTTPS/FIPS acceptance and deployment are not run or approved.**

Source is `d43cbb3efbfd1a55b830e07a1c5073cf83a4045e`, tree
`10f27bd4a1b4163217d109abd8a267d3a6186b94`. R12 preserves R11 and closes
the recovery-only findings that arrived after its freeze:

- `/api/friday/funding/confirm` may resume only a durable row already in
  `broadcasting`, `broadcast`, or `admitted`. A `claimed`, `prepared`, `signed`,
  `quarantined`, absent, or malformed row cannot create a new broadcast while
  recovery-only mode is active.
- The recovery-only public mint include denies new quote creation, mint
  execution, melts and unknown routes. It retains mint/key reads, existing
  quote-status reads, and value-conserving swap/checkstate/restore needed for
  already-originated operations.

Independent read-only review found no P0/P1 in the source logic. It retained
three P2 limits: the nginx rule set has static regression evidence rather than
a rendered `nginx -t` and live request matrix; public `/v1/swap` is not itself
bound to an application operation; and the mode switch must prove no old broad
`/v1/` proxy or normal authority process remains active.

## Exact sequence before any activation

1. Owner unlocks the existing bounded SSH agent and confirms key fingerprint
   `SHA256:IGu9dXOSXw4JoPmwNjAgDRI2AY+zJil/haJGjKRYt34`. No password or private
   key is shared.
2. Run the already bounded metadata-only four-host inventory with the pinned
   known-host file and exact SSH identity. Separately inventory the V2 provider
   firewall attachment/rules. Stop on any identity, account, unit, destination,
   certificate, path, or permission ambiguity; make no remote change.
3. Render an exact per-host plan from the inventory. Present one prerequisite
   approval covering the distinct V2 certificate/firewall, fresh fake-only
   identities, exact artifact/config destinations, isolated service staging,
   and services remaining non-public with admission disabled.
4. After approved staging, verify every Friday database, rollback anchor and
   browser-origin store is fresh/empty. Preserve and refuse any prior record.
   Verify the real controlled mint advertises NUT-12, uses the pinned active
   keyset, zero fees, and returns valid DLEQ in the retained canary.
5. Request a separate action-time approval for the exact-current trusted-HTTPS
   browser/Coco/FIPS acceptance and bounded V4-unavailable exercise. Retain the
   full evidence and obtain final review.
6. Request public activation approval only after the acceptance evidence is
   reviewed. Deployment approval must not be inferred from inventory, staging,
   or test approval.

Acceptance cannot precede the V2 TLS origin, isolated services and inactive
admission staging: the browser must validate the real certificate normally and
the FIPS paths must actually exist. No browser warning bypass, artificial trust,
Wednesday origin reuse, or non-FIPS transport may stand in for this gate.

## Recovery-only operator invariant

Recovery-only is effective only when all three conditions hold together:

1. site and authority have `POC_FRIDAY_RECOVERY_ONLY=true`;
2. the normal broad Friday `/v1/` include is absent and the exact reviewed
   recovery-only mint include is the sole Friday `/v1/` handler;
3. a harmless new funding/quote/mint request is refused without revision while
   one exact already-broadcast operation remains readable and recoverable.

The Friday origin, mint/keysets and durable state stay unchanged until every
accepted or ambiguous operation is terminal. Never repoint Friday to Wednesday,
replace the mint/keyset, clear state, or infer non-commitment from absence or
time.

## Remaining limits

- Exact current browser+IndexedDB+Nutshell+FIPS acceptance is NOT_RUN.
- Invalid post-swap DLEQ stays durably unavailable; no unsafe refund is made.
- Emergency unilateral timeout refund is not composed.
- Own raises remain disabled.
- A quote response lost before a durable operation ID remains unsupported.
- A selected FundingAbort signer lost after root claim fails closed until that
  signer returns.
- Fake sats only, one operator, jmcorgan/fips transport; no FIPS 140 or
  real-value claim.

Wednesday remains the tested fallback and must stay untouched.
