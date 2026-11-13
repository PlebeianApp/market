# Publication source reconciliation — 2026-11-13

Status: local, read-only reconciliation; not a deployment or publication
authorization.

## Reviewed base

The immutable reviewed base is commit
`0f15afef4dc3e4fce791fb36aa59e1742197b9f8`. It overlays the exact R86 source
commit `574f90b45bfe0b193f0e87e9a0e1cdaddd77bb34` onto the already published
contributor checkpoint `41c7098e13fb8854abf5e304653d91ca18e23d0b`.

R86 already contains the Chief Design A catalogue baseline, signed-profile
presentation baseline, terminal fast path and readiness coalescing. This
hygiene successor does not change product behavior.

## Later candidates

| Candidate | Classification | Disposition |
| --- | --- | --- |
| `9ed795b1810a63d735d6c96cc23e2164f63c8dd3` | Thirteen-file profile/demo improvement with a fixed five-relay discovery set and matching CSP | Deferred. It applies cleanly to R86 and focused UI tests pass, but requires relay privacy-policy approval, Go/Bun verification and a reproducible browser-bundle result on the combined tree. |
| R87–R90 V3 continuations | Host-, epoch- and incident-specific signer/FIPS recovery tooling | Excluded from the product checkpoint. Review separately as sanitized operator tooling if maintainers want it published. |
| Active dirty recovery checkout | Incident diagnostics, generated dependencies and host-specific state | Excluded entirely. |
| Public live `app.js` maintenance delta | Deployed behavior without a matching source commit, focused tests or release manifest | Excluded. Recreate from reviewed source and tests; never copy the deployed blob into source control as authority. |

The current public deployment has split provenance. Its `index.html`,
`friday-browser.js` and `styles.css` hashes match R86. Its `app.js` hash is
`ed16b33d0ff34974395a64262ab4ae52c345d7745190ed0b86a3d7d3a64a90a7`,
not R86's `c8efe5374d62d41ed79e4dfb840f1c8200a16eeccd1fc57001830c33bb1561f9`.
This is deployment evidence, not source provenance.

## Publication boundary

The outgoing branch remains R86 plus contributor documentation and bounded
publication hygiene. It does not contain the dashboard follow-up, live patch,
R87–R90 recovery continuations, runtime state, wallet material, signer shares,
credentials or raw operational logs.

Before a later candidate includes the profile/dashboard work, maintainers must
explicitly accept that profile discovery sends the connected public key to five
fixed public relays. The signed event, exact author, event kind, bounded fields,
newest-event selection, disconnect/actor replacement fencing and CSP must all
remain tested.

No repository, remote, service, wallet or live operation was modified during
the reconciliation.
