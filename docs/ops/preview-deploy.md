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

## The gateway is a tolerant HTTP client on purpose

`preview_gateway.py` does not use a bare `urllib.request.urlopen` for the
proxy hop. The preview app can emit a stray blank line **before** the status
line (raw socket read: `b"\r\n"` then `HTTP/1.1 200 OK ...`). RFC 9112 §2.2
lets a client ignore at least one empty line there and `curl` does — which is
why a `curl` health check of the app port can return `200` — but strict
clients (`http.client`/`urllib`) do not: they raise
`http.client.BadStatusLine('\r\n')`. The gateway therefore skips leading
empty line(s) before parsing the status line and otherwise parses the response
normally, so the body (chunked included) is still decoded by `http.client`.

For the same reason `_answer_route()` treats **any** proxy failure as a JSON
`503`: connect failures (`OSError`), malformed upstream replies
(`http.client.HTTPException`, e.g. `BadStatusLine`/`RemoteDisconnected`), and
anything else unexpected. A failure that escaped the handler would close the
connection with no reply at all and Caddy would render it as **502 Bad
Gateway** — indistinguishable from a routing or TLS problem. A logged 503 with
a `detail` field is debuggable; an empty 502 is not.

### The 503 "preview is starting" page

A preview is lazy-started, so the first visit to a stopped preview arrives while
the container is still booting. The gateway answers that window with `503`. For a
**browser** (`Accept: text/html`) it now returns a small self-contained page — no
external assets, since the app is not up yet — that says the preview is starting
and reloads itself every 5 s (`<meta http-equiv="refresh">` plus a cosmetic
countdown bar), so the viewer never has to hit refresh. The page is served **in
place**, not as a redirect: the URL keeps pointing at the preview, so the reload
lands on the app the moment it is ready.

Every other client — curl, `fetch()` from a script, uptime probes, and the CI
health check — keeps the machine-readable JSON body:

```json
{ "error": "preview not ready", "pr": 1271, "detail": "…" }
```

That preserves the health check's status/body assertions and the deploy comment,
which quotes `detail`. Both variants carry `Retry-After: 5`, and the technical
`detail` is HTML-escaped before it is rendered (it is text from an untrusted
upstream).

## The nak relay image is built from source on the host

The preview's `nak-relay` service used to pull `ghcr.io/fiatjaf/nak:latest`.
That image is no longer pullable — an anonymous token request for the
repository returns no token and the manifest GET is denied — so
`docker compose up` aborted inside the claim/compose step, the Cloudflare DNS
step never ran, and the preview URL stayed `NXDOMAIN`. The deploy now builds
the relay image **on the preview host** instead, in a step named **Build nak
image on VPS (registry image is gone)** placed between the deploy-package
upload and the port-offset claim: it clones `https://github.com/fiatjaf/nak.git`
into `/tmp/nak-build`, checks out `b65683886b58382890888fbdda90e5c2129df488`
(the pin upstream's own e2e workflow uses), and tags the result
`market-nak:b6568388`, which is the image the generated `docker-compose.yml`
names. The step runs through `infra/preview-vps/remote-ssh.sh` like every other
VPS step, is gated on `previews_ready`, and is cached on
`docker image inspect market-nak:b6568388` — a host that already has the image
skips the clone and build. The ordering is the point: the image must exist
before the claim/compose step resolves the tag.

## The app bundles its HTML at request time — ship `public/`, `styles/` and dev deps

`src/index.tsx` has no static middleware: it does `import index from
'./index.html'` and hands that import to Bun as the `/*` route, so Bun bundles
the shell (HTML + CSS + JS) **inside the preview container, on the first request
for `/`**. That bundle resolves every local asset the HTML references, so the
deploy package has to carry them:

- `src/index.html` → `../public/images/logo.svg`, `../public/favicon.ico`: ship
  `public/`. It also backs the `serveStatic` routes, so without it
  `/manifest.json` and `/favicon.ico` answer 500.
- `src/index.html` → `/styles/index.css` → `@import './globals.css'` →
  `styles/globals.css` → `@import 'tailwindcss'`: ship `styles/` **and**
  `bunfig.toml`, which enables `[serve.static] plugins =
["bun-plugin-tailwind"]` (the plugin that resolves that import).
- Install the **full** dependency set — `bun install`, not
  `bun install --production`. The production install drops `tailwindcss` (a
  devDependency) while keeping `bun-plugin-tailwind`, and the bundle then fails
  with `Could not resolve: "tailwindcss"`.

When the bundle cannot be built the app still answers: `GET /` returns
`200 OK` — or `500 Build Failed` — with **zero body bytes** and no
`Content-Type`, while `/api/config` keeps returning normal JSON and the process
logs a clean startup. That is why the health check requires a non-empty body
containing `<!doctype html` rather than merely a 2xx status: `curl -sf -o
/dev/null` exits 0 on an empty 200, which would report a blank page as a working
preview. Staging is unaffected because it serves a pre-built `dist/index.html`;
only the preview depends on request-time bundling.

To diagnose, run `docker compose logs market-app` in `~/previews/pr-<N>/` —
Bun's bundler prints the exact path it could not resolve.

## Why the check skips (missing preview secrets)

The deploy path consumes **six** secrets — the four VPS ones plus the two
Cloudflare ones used for the per-PR DNS record and the on-VPS `manager.env`:

- `PREVIEW_VPS_HOST`
- `PREVIEW_VPS_USER`
- `PREVIEW_VPS_SSH_KEY`
- `PREVIEW_VPS_HOST_FINGERPRINT`
- `PREVIEW_CLOUDFLARE_API_TOKEN`
- `PREVIEW_CLOUDFLARE_ZONE_ID`

`infra/preview-vps/provision.sh` aborts on the first of these that is unset
(`${VAR:?…}`), e.g.:

```
infra/preview-vps/provision.sh: line 39: PREVIEW_CLOUDFLARE_API_TOKEN is required
```

The workflow therefore checks **all six together** up front (step
`Check preview VPS secrets`): if any is missing it sets `previews_ready=false`,
emits a `::warning` naming the missing secrets, skips every VPS/DNS step, and
posts a "Preview deploy skipped" PR comment. The check reports a clean skip
rather than a red failure.

The two lists must stay in lockstep — a guard that asserts fewer secrets than
the deploy consumes reports "ready" and then dies inside `provision.sh`, which is
exactly how this check first went red. `bun run test:unit` enforces the
correspondence (`src/lib/__tests__/preview-deploy-workflow-guard.test.ts`), so
adding a required env var to `provision.sh` without extending the guard fails CI.

A `pull_request`-triggered workflow **never receives repository secrets when the
PR head is on a fork**, and GitHub additionally downgrades the workflow's
`GITHUB_TOKEN` to **read-only** for those runs. Both effects come from the same
place, so on a fork PR the guard skips cleanly (all six secrets resolve empty)
**and** the "Preview deploy skipped" comment cannot be posted — the comment step
fails with `GraphQL: Resource not accessible by integration (addComment)` and is
deliberately `continue-on-error`, leaving the skip visible only as the
`::warning` annotation and the `missing_secrets=` line in the run log. Fork-PR
previews therefore need the `pull_request_target` decision described below, not
just the secrets.

## Required secrets (maintainer-side)

For live previews, a maintainer with admin access to `PlebeianApp/market` must
add these as **repository secrets** (the `deploy` job currently has no
`environment:` binding, so repo-level secrets are required) —**or**, if the
trigger is switched to `pull_request_target`, as secrets scoped to that
environment:

| Secret                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PREVIEW_VPS_HOST`             | Hostname or public IP of the preview VPS                                                                                                                                                                                                                                                                                                                                                                              |
| `PREVIEW_VPS_USER`             | SSH user on that VPS (typically `debian`)                                                                                                                                                                                                                                                                                                                                                                             |
| `PREVIEW_VPS_SSH_KEY`          | PEM private key for SSH/scp (multiline; must be a valid key)                                                                                                                                                                                                                                                                                                                                                          |
| `PREVIEW_VPS_HOST_FINGERPRINT` | SSH **host**-key SHA256 fingerprint of the VPS, format `SHA256:…` (from `ssh-keyscan -t ed25519 <host> \| ssh-keygen -lf -`). `ssh-prepare.sh` verifies the materialised key against it, and `provision.sh` compares it against the scanned key and aborts before any private-key material is exchanged. A host-key fingerprint is per-**host**, not per-**port**, so it stays valid when the SSH port changes.       |
| `PREVIEW_VPS_SSH_PORT`         | **OPTIONAL** — sshd port on the preview VPS. Leave unset (or empty) for the default **22**, which is what the current box uses. Set it only when the host is fronted by a non-standard ingress (NAT/port-forward, different sshd port). `ssh-prepare.sh` publishes it to `$GITHUB_ENV`, `remote-ssh.sh`/`remote-scp.sh` use it for `-p`/`-P`, and `provision.sh` uses it for `ssh-keyscan -p`, `ssh -p` and `scp -P`. |
| `PREVIEW_CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Zone → DNS → Edit** on the `orangesync.tech` zone (the manager deletes preview records; the deploy upserts them)                                                                                                                                                                                                                                                                          |
| `PREVIEW_CLOUDFLARE_ZONE_ID`   | Cloudflare zone id for the zone that holds `test-market.orangesync.tech` (currently `orangesync.tech`)                                                                                                                                                                                                                                                                                                                |

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

Pin the **ed25519** fingerprint — the workflow's OpenSSH helpers negotiate `ssh-ed25519` explicitly, and `provision.sh` scans with `-t ed25519`. See § g for why a Go-based SSH action cannot share this pin.

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

### f) The private key must end with a newline

`PREVIEW_VPS_SSH_KEY` is materialised to a file at run time. OpenSSH requires
the **final line to be newline-terminated**; a key whose last byte is not `\n`
is rejected:

```
Load key "/tmp/tmp.XXXX": error in libcrypto
...
Received disconnect ... Too many authentication failures
```

Both messages point away from the cause, and the second one sends you looking at
`authorized_keys`. GitHub **strips trailing newlines from secret values**, so a
key that is perfectly valid on disk arrives without its final newline and every
deploy fails.

The workflow restores it and then proves the result is loadable, so this fails
loudly at the materialisation step instead of three steps later:

```bash
if [ -n "$(tail -c1 "$KEY_FILE")" ]; then printf '\n' >> "$KEY_FILE"; fi
chmod 600 "$KEY_FILE"
ssh-keygen -y -f "$KEY_FILE" >/dev/null   # must succeed
```

Regression test: `infra/preview-vps/test_key_materialisation.sh` (proves the
unterminated key is rejected and the guard repairs it, byte-for-byte).

If you set the secret yourself, verify the round trip the same way rather than
trusting the upload:

```bash
gh secret set PREVIEW_VPS_SSH_KEY --repo PlebeianApp/market < ~/.ssh/<key>
# then a preview-deploy run must get past "Bootstrap VPS"
```

### g) Every VPS connection must use OpenSSH — never a Go-based SSH action

**Rule: no `appleboy/*` (or any other Go/drone-ssh) action may reach the preview
VPS.** All VPS access goes through the OpenSSH helpers in `infra/preview-vps/`:

| Helper                       | Role                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssh-prepare.sh <workdir>`   | materialises the private key from `PREVIEW_VPS_SSH_KEY`, applies the trailing-newline guard (§ f), writes a private `known_hosts` pinned to the **ed25519** host key, verifies it against `PREVIEW_VPS_HOST_FINGERPRINT`, and publishes `PREVIEW_KEY_FILE` / `PREVIEW_KNOWN_HOSTS` / `PREVIEW_SSH_PORT` / `PREVIEW_SSH_TARGET` to `$GITHUB_ENV`. Called by **both** the deploy and the teardown job. |
| `remote-ssh.sh <cmd…>`       | runs a command — or, with `bash -s`, a script fed on stdin — with the single pinned option set (`StrictHostKeyChecking=yes`, private `UserKnownHostsFile`, `HostKeyAlgorithms=ssh-ed25519`, `BatchMode=yes`).                                                                                                                                                                                        |
| `remote-scp.sh <src…> <dst>` | copies files with the same pin. Note the UPPERCASE `-P` for the port; `scp`'s lowercase `-p` means "preserve mtime".                                                                                                                                                                                                                                                                                 |

**Why.** `appleboy/ssh-action` is not OpenSSH — it is a Go program (drone-ssh on
`golang.org/x/crypto/ssh`), and its **default** `HostKeyAlgorithms` negotiate a
different host key than OpenSSH does against the same host. Measured on
2026-09-11 against `23.182.128.51:22` with an unmodified Go ssh client (no
algorithm preference set, host-key callback recording what was negotiated):

```
OpenSSH -> ssh-ed25519          SHA256:rjbvoYsKckQMv/L9Y4LQNCx86z95pqonoNGmXdUS41M
Go      -> ecdsa-sha2-nistp256  SHA256:UTl0gzMwYlKNuORtrA8jxS7gmj9U1x8taGQh5vxaXQo
```

(These are public host-key fingerprints — every client is handed them. The host
offers three host keys: ed25519, RSA 3072 and ECDSA P-256. Re-measure a host
with `ssh-keyscan -t ed25519 <host> | ssh-keygen -lf -`.)

`provision.sh` uses OpenSSH and pins the **ed25519** key, so
`PREVIEW_VPS_HOST_FINGERPRINT` is _defined_ as the ed25519 fingerprint. A
Go-based action negotiated ECDSA, compared it to that ed25519 pin, and failed —
so **one secret could not satisfy both stacks**, and every appleboy step died
with:

```
ssh: handshake failed: ssh: host key fingerprint mismatch
```

Because `provision.sh` ran _first_ (as a plain `run:` step) and succeeded, the
failure surfaced two steps later, in unrelated-looking SSH steps, while the DNS
record step had not yet run — leaving `pr<N>.test-market.orangesync.tech`
unresolvable (`NXDOMAIN`) with no preview containers on the host at all.

**Repointing the secret at the ECDSA fingerprint is NOT a fix**: `provision.sh`
would then fail its own `ssh-keyscan -t ed25519` comparison, and its known_hosts
would hold an ECDSA record while it forces `HostKeyAlgorithms=ssh-ed25519`.

**Regression guard.** `infra/preview-vps/test_pinned_openssh.sh` fails if any
`uses: appleboy/…` reappears, if the workflow calls `ssh`/`scp` directly instead
of through the helpers, or if a helper stops pinning the host key. It also fails
if any `.github/workflows/*.yml` spells an expression placeholder inside a shell
comment in a `run:` body — a file GitHub cannot parse loads no workflow, runs no
job and reports **no check run at all**, so the pull request looks green while
every preview deploy dies — and, when `actionlint` is installed, if that tool
reports any error in those files. Run it (and `test_ssh_port.sh`,
`test_key_materialisation.sh`) before touching this workflow.

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

## Troubleshooting a red or silent preview check

1. **The check went red inside `provision.sh`.** The guard was satisfied but the
   deploy needs something the guard does not assert. Read the last line of the
   "Bootstrap VPS" step; the missing secret is named there.
2. **The deploy reached the VPS but SSH/timing failed.** Confirm the host in
   `PREVIEW_VPS_HOST` still exists. A recycled or retired VPS IP leaves the DNS
   A record behind, so `test-market.orangesync.tech` keeps resolving to a dead
   address while the live host has moved — verify the A record against the
   intended host before blaming the workflow.
   ```bash
   dig +short test-market.orangesync.tech
   ssh-keyscan -t ed25519 "$PREVIEW_VPS_HOST" | ssh-keygen -lf -   # fingerprint for the secret
   ```
   If the fingerprint changed (provider reinstall, new host), update
   `PREVIEW_VPS_HOST_FINGERPRINT` in the same change as `PREVIEW_VPS_HOST`.
3. **Previews never appear although the check is green.** A green check in the
   `skipped` state means the secrets are absent; look for the
   `Preview deploy skipped` comment and the `missing_secrets=` line in the run.
4. **The PR comment is not updated when a PR closes.** The `teardown` job has no
   checkout on purpose (the head branch can be deleted before the close event),
   so it runs `gh` with `GH_REPO` set. Without that repository context
   `gh pr comment` aborts with `failed to run git: fatal: not a git repository`
   and the comment keeps the old "preview live" text.

## Security notes

**SSH host-key verification (no TOFU, no `StrictHostKeyChecking=no`).** Every
SSH/scp connection — the pinned OpenSSH helpers and `provision.sh` — verifies
the VPS host key against `PREVIEW_VPS_HOST_FINGERPRINT` before the deploy key is
used. `ssh-prepare.sh` writes a private `known_hosts` and checks the scanned key
against the pinned fingerprint before any connection; `remote-ssh.sh` and
`remote-scp.sh` then run with `StrictHostKeyChecking=yes`,
`HostKeyAlgorithms=ssh-ed25519` and that private `known_hosts`. `provision.sh`
scans the host key, compares its SHA256 fingerprint to the pinned secret, and
aborts on mismatch before any authentication, pinning the negotiation to the
verified ed25519 key. A MITM on the path never receives the private key.

**No third-party action holds the deploy key.** The VPS private key is handled
only by this repository's own OpenSSH helper scripts — plain shell, reviewed
in-tree — so there is no pinned third-party SSH action in the path that a
mutated upstream tag could turn into a key exfiltration. Re-adding
`uses: appleboy/…` (or any other Go/drone-ssh action) is a regression:
`infra/preview-vps/test_pinned_openssh.sh` fails if it reappears.

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
