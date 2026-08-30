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

## Why the check skips (empty `PREVIEW_VPS_*` secrets)

The "Bootstrap VPS" step consumes three secrets:

- `PREVIEW_VPS_HOST`
- `PREVIEW_VPS_USER`
- `PREVIEW_VPS_SSH_KEY`

(and, for the DNS record step):

- `PREVIEW_CLOUDFLARE_API_TOKEN`
- `PREVIEW_CLOUDFLARE_ZONE_ID`

A `pull_request`-triggered workflow **never receives repository secrets when
the PR head is on a fork**. `secrets.PREVIEW_VPS_*` resolve to empty strings in
the runner, so `provision.sh` aborts immediately with:

```
infra/preview-vps/provision.sh: line 20: PREVIEW_VPS_HOST: PREVIEW_VPS_HOST is required
```

The workflow now detects this up front (step `Check preview VPS secrets`),
emits a clear annotation, skips all VPS/DNS/deploy steps, and posts a
"Preview deploy skipped" PR comment instead of failing confusingly. The
"Deploy preview" check reports success (skipped) in this state.

## Required secrets (maintainer-side)

For live previews, a maintainer with admin access to `PlebeianApp/market` must
add these as **repository secrets** (the `deploy` job currently has no
`environment:` binding, so repo-level secrets are required) —**or**, if the
trigger is switched to `pull_request_target`, as secrets scoped to that
environment:

| Secret                         | Value                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| `PREVIEW_VPS_HOST`             | Hostname or public IP of the preview VPS                     |
| `PREVIEW_VPS_USER`             | SSH user on that VPS (typically `debian`)                    |
| `PREVIEW_VPS_SSH_KEY`          | PEM private key for SSH/scp (multiline; must be a valid key) |
| `PREVIEW_CLOUDFLARE_API_TOKEN` | Cloudflare API token (DNS edit on the zone)                  |
| `PREVIEW_CLOUDFLARE_ZONE_ID`   | Cloudflare zone id for `test-market.orangesync.tech`         |

If any required secret is missing the workflow skips loudly instead of failing
opaque — do not treat a green "skipped" check as proof previews are live.

## Security note: `pull_request_target` (do not switch blindly)

To get real previews from **fork** PR branches you would need the secrets in
the runner, which `pull_request` does not allow. The typical workaround is
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
