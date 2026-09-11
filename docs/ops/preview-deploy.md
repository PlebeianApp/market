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

| Secret                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PREVIEW_VPS_HOST`             | Hostname or public IP of the preview VPS                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PREVIEW_VPS_USER`             | SSH user on that VPS (typically `debian`)                                                                                                                                                                                                                                                                                                                                                                                                       |
| `PREVIEW_VPS_SSH_KEY`          | PEM private key for SSH/scp (multiline; must be a valid key)                                                                                                                                                                                                                                                                                                                                                                                    |
| `PREVIEW_VPS_HOST_FINGERPRINT` | SSH **host**-key SHA256 fingerprint of the VPS, format `SHA256:…` (from `ssh-keyscan -t ed25519 <host> \| ssh-keygen -lf -`). The same secret verifies the host in the appleboy actions (`fingerprint:` input) and in `provision.sh`, which compares it against the scanned key and aborts before any private-key material is exchanged. A host-key fingerprint is per-**host**, not per-**port**, so it stays valid when the SSH port changes. |
| `PREVIEW_VPS_SSH_PORT`         | **OPTIONAL** — sshd port on the preview VPS. Leave unset (or empty) for the default **22**, which is what the current box uses. Set it only when the host is fronted by a non-standard ingress (NAT/port-forward, different sshd port). `port:` is passed to every `appleboy/ssh-action` + `appleboy/scp-action` step as `${{ secrets.PREVIEW_VPS_SSH_PORT \|\| 22 }}`, and `provision.sh` uses it for `ssh-keyscan -p`, `ssh -p` and `scp -P`. |
| `PREVIEW_CLOUDFLARE_API_TOKEN` | Cloudflare API token (DNS edit on the zone)                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PREVIEW_CLOUDFLARE_ZONE_ID`   | Cloudflare zone id for `test-market.orangesync.tech`                                                                                                                                                                                                                                                                                                                                                                                            |

If any required secret is missing the workflow skips loudly instead of failing
opaque — do not treat a green "skipped" check as proof previews are live.
`PREVIEW_VPS_SSH_PORT` is **not** part of that guard: it is optional and
defaults to 22, so the deploy does not skip when it is absent.

## VPS prerequisites (one-time, per host)

The workflow assumes a Linux box that is already reachable over SSH with a
deploy user that can `sudo`. The worked example below is the current preview
host: `23.182.128.51` (hostname `testserver2`, Debian 13, deploy user
`debian`), whose sshd listens on port **22**. Do these four steps once per
host. They are operator tasks — `provision.sh` installs Docker/Caddy/the
gateway/the manager but deliberately does **not** touch SSH auth, fail2ban,
or the firewall.

### a) Dedicated deploy keypair (never a personal identity key)

Generate a keypair that exists **only** for this automation, append its
public half to the deploy user's `authorized_keys`, and upload the private
half as the repo secret straight from the file — so no key material is ever
pasted into a chat or the GitHub web UI.

```bash
# 1. DEDICATED, passphrase-less keypair for CI only. Tag the comment so it
#    is obvious this is not a personal identity key. (The CI runner cannot
#    unlock a passphrase, hence -N ''.)
ssh-keygen -t ed25519 -C 'preview-deploy@ci' -f ~/.ssh/preview_deploy_ed25519 -N ''

# 2. Append the PUBLIC half to the deploy user's authorized_keys on the VPS
#    (as its own line). Replace the -i key with your own operator key.
ssh -i ~/.ssh/<operator-key> debian@23.182.128.51 \
  'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys' \
  < ~/.ssh/preview_deploy_ed25519.pub

# 3. Upload the PRIVATE half as the repo secret — the file is the sole
#    content of PREVIEW_VPS_SSH_KEY.
gh secret set PREVIEW_VPS_SSH_KEY --repo PlebeianApp/market < ~/.ssh/preview_deploy_ed25519

# 4. Prove the key works before wiring it into CI.
ssh -i ~/.ssh/preview_deploy_ed25519 debian@23.182.128.51 'echo ok'
```

Revoke by removing that one line from `~/.ssh/authorized_keys` on the VPS;
the personal key is never involved.

### b) fail2ban must not ban the operator or the CI runners

fail2ban's `sshd` jail bans a source after a few failed auth attempts. CI
runner IPs change every run, so a runner that fails auth a handful of times
gets banned — and **a banned source sees SSH _time out_, not `Permission
denied`**. That is indistinguishable from a closed/filtered port and is a
classic multi-hour debugging trap. Whitelist every egress CIDR the operator
and CI can appear from:

```bash
sudo tee /etc/fail2ban/jail.d/00-operator-whitelist.local > /dev/null <<'EOF'
[DEFAULT]
# Never ban the operator or the CI runners. Replace the CIDRs below with
# your own egress ranges; 127.0.0.1/8 and ::1 cover on-box checks.
ignoreip = 127.0.0.1/8 ::1 <operator CIDR> <operator CIDR 2>
EOF

sudo systemctl reload fail2ban
sudo fail2ban-client status sshd   # confirm: "IP list:" should not contain you
```

Diagnostics and the fix for an already-banned source:

```bash
sudo fail2ban-client status sshd                    # banned IP list + totals
sudo fail2ban-client set sshd unbanip 203.0.113.7   # unban one source now
```

**Rule of thumb:** if `ssh` hangs and then times out (instead of answering
`Permission denied`), suspect fail2ban before you suspect the port or ufw.

### c) Open the SSH port in the firewall

```bash
sudo ufw allow 22/tcp        # or: sudo ufw allow "${PREVIEW_VPS_SSH_PORT}/tcp"
sudo ufw status verbose
```

`ufw` is stateful and per-port: if you later move sshd to a non-standard port,
open that port instead and set `PREVIEW_VPS_SSH_PORT` to match. Leaving 22
open as well is fine — this only affects reachability, not authentication.

### d) The host-key fingerprint is per-HOST, not per-PORT

`PREVIEW_VPS_HOST_FINGERPRINT` stays valid if the port changes, because a
host key belongs to the host, not to the listening port:

```bash
# Fingerprint for 23.182.128.51 on port 22 (the value to pin in the secret).
ssh-keyscan -p 22 -t ed25519 23.182.128.51 | ssh-keygen -lf -
# → 23.182.128.51 ED25519 SHA256:rjbvoYsKckQMv/L9Y4LQNCx86z95pqonoNGmXdUS41M
```

A host key belongs to the **host**, so the same fingerprint comes back from any
port that reaches _that host's_ sshd. It is not, however, a property of the IP:
on this box port 2222 reaches a different machine entirely (see the socat
warning below), so always verify against the port you are actually pinning.

So changing `PREVIEW_VPS_SSH_PORT` never requires re-issuing
`PREVIEW_VPS_HOST_FINGERPRINT`.

### e) `ssh-keyscan` prints a comment line first — never pipe it into `head -n 1`

`ssh-keyscan` writes a banner comment **before** the key:

```
# 23.182.128.51:22 SSH-2.0-OpenSSH_10.0p2 Debian-7+deb13u4   ← comment, printed FIRST
23.182.128.51 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOQssByZ…  ← the key
```

So `ssh-keyscan … | head -n 1` captures the **comment**, `ssh-keygen -lf -`
cannot parse it, the computed fingerprint comes out empty, and the deploy aborts
with a **bogus** `FATAL: host key fingerprint mismatch` — pointing the operator
at the secret when the secret is perfectly fine. Every deploy fails.

Skip the comment lines instead:

```bash
# One scan, first real known_hosts record (3 fields, first field not a comment).
ssh-keyscan -T 10 -p 22 -t ed25519 23.182.128.51 2>/dev/null \
  | awk 'NF >= 3 && $1 !~ /^#/ { print; exit }' | ssh-keygen -lf -
```

`provision.sh` does exactly this and has a test for it
(`infra/preview-vps/test_ssh_port.sh`). Diagnose the two failure modes apart:

- **`could not reach … to fetch its host key`** → no key was offered at all.
  Network/target/firewall problem, or fail2ban has banned your source. Cannot be
  caused by a wrong fingerprint.
- **`host key fingerprint mismatch`** with a non-empty `actual:` → the host
  answered with a key that does not match the pinned secret. Either the host
  was rebuilt (re-keyed) or you are pinning the wrong host/port.

### ⚠️ Legacy socat forwarder on port 2222 — do NOT use it

`testserver2` also runs a legacy systemd unit `fips-ssh-proxy.service` that
listens on public `0.0.0.0:2222` and forwards (via `socat`) to a **different**
host over a mesh network. Port 2222 on that box is therefore **not** this
machine's sshd. Never set `PREVIEW_VPS_HOST=23.182.128.51` with
`PREVIEW_VPS_SSH_PORT=2222` expecting to land on the preview VPS: you would
reach an entirely different machine, and the pinned host-key fingerprint check
would (correctly) fail. Use port 22 — or whatever port the box's own sshd is
moved to — and verify with `ssh-keyscan -p <port> -t ed25519 <host>` matching
the pinned fingerprint before deploying.

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
