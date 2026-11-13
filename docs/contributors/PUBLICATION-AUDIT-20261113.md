# Publication audit — 2026-11-13

Verdict: **blocked from push**. Source provenance, Git integrity and the bounded
credential scans passed; licensing and operational-disclosure decisions remain.

## Completed review

The independent review scanned the complete outgoing patch, 1,127 tracked
files and every member of four tracked dependency archives. It found no private
key blocks, Nostr `nsec` values, GitHub/AWS/Slack token forms, literal
Basic/Bearer credentials, wallet seeds, signer secret shares, bearer-proof
objects, unsafe archive paths or archive symlinks. Negative-test fixtures and
fixed fake-mint constants were reviewed as false positives.

This is a high-confidence pattern and structural scan, not a substitute for a
recognized full-history secret scanner.

## Licensing gate

The target `PlebeianApp/market` repository currently identifies its default
branch as GPL-3.0 and contains a root `LICENSE`. This snapshot branch does not
contain that license. Maintainers must confirm that the upstream project license
governs this checkpoint and add the exact reviewed license file; this preparation
does not make that legal decision.

The four vendored Coco archives identify packages from the Coco project but do
not embed license files or package `license` fields. The current upstream Coco
repository identifies itself as MIT, but the exact pinned source revision,
local modifications and redistribution notices still require verification.
Add a third-party notice and exact license texts only after that provenance is
confirmed.

## Operational disclosure gate

The outgoing source includes signer-incident diagnostics, service templates,
deployment JSON and evidence records. Some contain public verifying shares,
state/process digests and current topology addresses. These are not private
keys, but maintainers must either explicitly approve their publication or
replace current topology/fingerprints with synthetic fixtures in a separately
reviewed change.

The R87–R90 continuation tooling and dirty recovery state remain excluded.

## Remaining gates

1. Confirm the project license and complete the third-party license/notice
   inventory for the exact vendored archives and modifications.
2. Decide whether current topology and operational fingerprints are public.
3. Run a recognized full-history secret scan and an SBOM/license tool.
4. Complete the Go and native Rust gates recorded in
   `REPRODUCIBILITY-20261113.md`.
5. Reconcile one exact deployed release and complete live fake-sat payment
   acceptance separately.
6. Re-read both remote refs and verify identities immediately before an
   explicitly approved, non-force push.
