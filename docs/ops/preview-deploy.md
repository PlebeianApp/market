# Preview Deploy — configuration & known issues

This document explains how the PR preview-deployment workflow
(`.github/workflows/preview-deploy.yml`) is configured and why it may skip,
plus the exact secrets the maintainer must set to enable live per-PR previews.

## What it does

On `pull_request` events (`opened`, `synchronize`, `closed`), the workflow
builds the market app, ships a deploy package to a shared test VPS over SSH,
brings up per-PR `docker compose` services (market app + nak relay on offset
ports), creates a Cloudflare A record `pr{N}.test-market.orangesync.tech`, and
posts the live URL as an idempotent PR comment. On `closed` it tears the
preview down.

The deploy path claims a **port-offset marker** on the VPS
(`preview_manager.py --claim-port-offset N`, marker file
`~/previews/ports/<offset>`) **before** `docker compose up`. PRs congruent
mod 100 (e.g. #1257 and #1357) share the same host-port offset; the claim
fails the deploy loudly rather than letting two compose projects race on the
same host ports. Teardown (and manager cleanup of closed PRs) releases the
marker.

## VPS components (provisioned by `infra/preview-vps/provision.sh`)

The provision script is idempotent and safe to re-run from CI: it compares
unit-file content and shipped-file hashes before restarting anything, so a
re-run with no changes never bounces a live service. On a bare Debian box it
installs Docker and Caddy, then sets up:

- **`preview_gateway.py`** (`preview-gateway.service`, running as the
  provisioned user, not root): the single front door for
  `*.test-market.orangesync.tech`. It answers Caddy's on-demand-TLS `ask`
  checks (approving `pr{N}.test-market.orangesync.tech`), routes `Host:
pr{N}` to this PR's app port, and — on **every** request — pokes the
  manager (`preview_manager.py --wake N`) so a stopped preview boots. The
  router holds the connection up to ~15 s while the preview boots; if it
  never comes up it returns a JSON `503`.
- **Caddy**: the version-controlled site block for
  `*.test-market.orangesync.tech` with on-demand TLS (`ask` → gateway), a
  JSON access log to `/var/log/caddy/access.json` (0644, readable by the
  manager's non-root unit), and `reverse_proxy` to the gateway.
- **`preview_manager.py`** (`preview-manager.service` + timer, every
  10 min): the only writer of preview lifecycle decisions. It stops
  previews idle beyond `IDLE_HOURS` (per the Caddy access log — a preview
  with **no recorded access** is treated as unknown, logged loudly, and
  **not** stopped), ranks open PRs by `pushed_at` and keeps only the top-K
  (K=5) most recently pushed previews running, tears down previews whose PR
  is closed (running or not), and releases orphaned port markers. DNS-record
  deletion uses Cloudflare credentials loaded from
  `~/preview-infra/manager.env` (chmod 600).

**CI never runs the manager** (`preview_manager.py --cron` is not invoked
from the workflow). Over SSH it would have no GitHub credentials, so the
open-PR list would resolve empty and the cycle would treat every live
preview as belonging to a closed PR and destroy it — fail-open destructive.
The systemd timer on the VPS owns the preview lifecycle exclusively.

**Fail-closed cleanup:** the manager's closed-PR cleanup and recency-stop
decisions depend on a trusted open-PR list. If the (anonymous, public-repo)
GitHub API query fails, rate-limits, or returns a truncated list, the cycle
makes **no** destructive decisions for that run — it logs a `skip_reason`
line (visible in `journalctl`) instead. Teardown failures are recorded in
the cycle summary and the preview is kept for retry rather than deleted.

## Why the check skips (empty `PREVIEW_VPS_*` secrets)

The "Bootstrap VPS" step consumes four secrets:

- `PREVIEW_VPS_HOST`
- `PREVIEW_VPS_USER`
- `PREVIEW_VPS_SSH_KEY`
- `PREVIEW_VPS_HOST_FINGERPRINT`

(and, for the DNS record step and the on-VPS `manager.env`):

- `PREVIEW_CLOUDFLARE_API_TOKEN`
- `PREVIEW_CLOUDFLARE_ZONE_ID`

A `pull_request`-triggered workflow **never receives repository secrets when
the PR head is on a fork**. `secrets.PREVIEW_VPS_*` resolve to empty strings in
the runner, so `provision.sh` aborts immediately with:

```
infra/preview-vps/provision.sh: PREVIEW_VPS_HOST is required
```

The workflow detects this up front (step `Check preview VPS secrets`),
emits a clear annotation, skips all VPS/DNS/deploy steps, and posts a
"Preview deploy skipped" PR comment instead of failing confusingly. The
"Deploy preview" check reports success (skipped) in this state.

## Required secrets (maintainer-side)

For live previews, a maintainer with admin access to `PlebeianApp/market` must
add these as **repository secrets** (the `deploy` job currently has no
`environment:` binding, so repo-level secrets are required) —**or**, if the
trigger is switched to `pull_request_target`, as secrets scoped to that
environment:

| Secret                         | Value                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PREVIEW_VPS_HOST`             | Hostname or public IP of the preview VPS                                                                                                                                                                                                                                                                                                 |
| `PREVIEW_VPS_USER`             | SSH user on that VPS (typically `debian`)                                                                                                                                                                                                                                                                                                |
| `PREVIEW_VPS_SSH_KEY`          | PEM private key for SSH/scp (multiline; must be a valid key)                                                                                                                                                                                                                                                                             |
| `PREVIEW_VPS_HOST_FINGERPRINT` | SSH **host**-key SHA256 fingerprint of the VPS, format `SHA256:…` (from `ssh-keyscan -t ed25519 <host> \| ssh-keygen -lf -`). The same secret verifies the host in the appleboy actions (`fingerprint:` input) and in `provision.sh`, which compares it against the scanned key and aborts before any private-key material is exchanged. |
| `PREVIEW_CLOUDFLARE_API_TOKEN` | Cloudflare API token (DNS edit on the zone)                                                                                                                                                                                                                                                                                              |
| `PREVIEW_CLOUDFLARE_ZONE_ID`   | Cloudflare zone id for `test-market.orangesync.tech`                                                                                                                                                                                                                                                                                     |

If any required secret is missing the workflow skips loudly instead of failing
opaque — do not treat a green "skipped" check as proof previews are live.

## Security notes

**SSH host-key verification (no TOFU, no `StrictHostKeyChecking=no`).** Every
SSH/scp connection — both the appleboy actions (`fingerprint:` input on every
step) and `provision.sh` — verifies the VPS host key against
`PREVIEW_VPS_HOST_FINGERPRINT` before the deploy key is used. `provision.sh`
scans the host key, compares its SHA256 fingerprint to the pinned secret, and
aborts on mismatch before any authentication, pinning the negotiation to the
verified ed25519 key. A MITM on the path never receives the private key.

**Pinned third-party actions.** The `appleboy/ssh-action` and
`appleboy/scp-action` steps — which handle the VPS private key — are pinned by
commit SHA (with the version in a trailing comment), so a mutated upstream tag
cannot exfiltrate the key. Audit the SHA when bumping the version.

**`pull_request_target` (do not switch blindly).** To get real previews from
**fork** PR branches you would need the secrets in the runner, which
`pull_request` does not allow. The typical workaround is
`pull_request_target`, which runs the workflow with the **base branch's**
workflow file and grants repository secrets. That is a privilege escalation
vector: a malicious PR can alter the base-branch workflow to exfiltrate
secrets. If you adopt it, you MUST:

1. Pin the checkout to a trusted ref (never `actions/checkout` on the
   untrusted PR merge ref with default settings), and
2. Never interpolate PR-controlled content (e.g. `github.event.pull_request.*`)
   into shell strings or actions that touch secrets, and
3. Review the workflow every time the pinned ref is bumped.

Given the added risk and that previews are explicitly not a merge gate
(Layer G of the PR trust pipeline), the safer long-term option is for the
maintainer to push the preview-deploy workflow changes onto `master` and run
the preview deploy there via `pull_request` with `if:` guards on
`github.head_ref` / `github.repository`, keeping the fork-PR case as a loud
skip. Revisit only if maintainer wants live fork-PR previews.

## Status handling (why the run is no longer masked)

Previously the job had job-level `continue-on-error: true`, which set the **run**
conclusion to `success` while an individual step still reported a red FAIL check
— a mismatch that hid the real failure. The job now uses step-level guards
(keyed on `steps.secrets.outputs.previews_ready`) instead: secrets missing →
all VPS/DNS steps skip with a visible annotation and a "skipped" PR comment;
secrets present → steps run and a real failure surfaces as a red check.

**Health-check reporting.** The health check retries for ~3 minutes; individual
failed attempts inside that loop are transient warm-up (preview booting, DNS
propagating, certificate issuance). If the check fails after all attempts, the
step exits nonzero and the PR comment flips to an explicit 🔴 degraded/failed
state with a link to the workflow run — never an open-ended "still warming up"
message. A deploy-step failure before the health check (e.g. a port-offset
collision) posts the same explicit 🔴 failed state.
