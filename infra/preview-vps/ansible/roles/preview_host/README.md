# preview_host

Provision a **Plebeian Market per-PR preview host**.

This role is the reproducible, declarative counterpart to
`infra/preview-vps/provision.sh` (the script the `Preview Deploy` workflow runs
over SSH on every deploy). Use it to stand up a brand-new box; thereafter the
workflow's `Bootstrap VPS` step keeps it converged.

## What it does

- Installs the **Docker Inc stack** (`docker-ce`, `docker-ce-cli`,
  `containerd.io`, `docker-compose-plugin`, `docker-buildx-plugin`). Debian's
  `docker.io` does **not** ship the Compose v2 plugin the workflow needs, so a
  host provisioned with it fails at `docker compose up` with exit 125. The
  conflicting Debian packages are removed first; guarded on
  `docker compose version`, so it is a no-op once satisfied.
- Installs Caddy (official repo).
- Creates `/home/<user>/preview-infra` and `/home/<user>/previews`.
- Ships `preview_gateway.py` and `preview_manager.py` **straight from this
  repo** (no network fetch, no pinned ref — the role and the scripts cannot
  drift).
- Writes `manager.env` (Cloudflare creds, `0600`) for closed-PR DNS cleanup.
- Installs and enables `preview-gateway.service` and
  `preview-manager.service` + `preview-manager.timer`.
- Writes `/etc/caddy/Caddyfile` with the on-demand-TLS `ask` endpoint and the
  `*.test-market.orangesync.tech` route (JSON access log for idle detection).

The legacy co-located **nsite gateway is off** by default
(`preview_host_nsite_gateway: false`): previews do not need it and its upstream
(`github.com/fiatjaf/nsite`) is no longer cloneable.

## Usage

```bash
PREVIEW_VPS_HOST=<host-ip> \
PREVIEW_VPS_SSH_KEY_FILE=~/.ssh/preview_vps_deploy \
PREVIEW_CLOUDFLARE_API_TOKEN=<token> PREVIEW_CLOUDFLARE_ZONE_ID=<zone-id> \
  ansible-playbook playbooks/preview-host.yml
```

## Key variables

| Variable                                                                | Default                       | Purpose                                      |
| ----------------------------------------------------------------------- | ----------------------------- | -------------------------------------------- |
| `preview_host_user`                                                     | `{{ ansible_user }}`          | Deploy user that owns the preview dirs.      |
| `preview_host_gateway_port`                                             | `6799`                        | Local port Caddy proxies preview traffic to. |
| `preview_host_site_suffix`                                              | `test-market.orangesync.tech` | Preview subdomain suffix.                    |
| `preview_host_cloudflare_api_token` / `preview_host_cloudflare_zone_id` | env                           | Manager DNS cleanup.                         |
| `preview_host_nsite_gateway`                                            | `false`                       | Enable the legacy nsite gateway.             |

## Relationship to `provision.sh`

**`provision.sh` is authoritative at deploy time.** The Preview Deploy workflow
runs it over SSH on every deploy; this role is the reproducible path for
standing up a fresh box (and converging a drifted one). A change to ports,
systemd units, or the Caddy route must land in **both** places, or the next
deploy will silently drift the host back — the role's own `tests`/`--check`
cannot catch that, so review both files together.

## Host-key policy

The role pins the host key, fail-closed: the playbook's first play scans the
host's ed25519 key, verifies it against `PREVIEW_VPS_HOST_FINGERPRINT`, and
writes a private `known_hosts`; the second play connects with
`StrictHostKeyChecking=yes` and `HostKeyAlgorithms=ssh-ed25519` against it.
There is no TOFU (`accept-new`) path — an unknown or changed key is a hard
failure, exactly like `provision.sh`.
