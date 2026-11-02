# Friday R20 inert service templates

These files are a separate fake-money R20 candidate. They do not replace the
V2 templates or any Wednesday unit. The immutable release root is exactly
`/opt/plebeian-auctions-friday/releases/r20-deploy-v1`.
It is a root-owned, non-writable directory created once; there is no `current`
symlink and no file may be overwritten in place. All seven R20 units use the
verifier and native executables from its `bin/` directory. The copied `fips`
and identity verifier must be byte-identical to their independently pinned
shared artifacts. The external Nutshell environment is deliberately excluded
from that claim and remains an activation gate.

Rendered public configuration has these exact destinations and metadata:

* `/etc/plebeian-auctions-friday` is `root:plebeian-friday 0750`;
* `friday.env`, `application.json`, `authority.json`, and `mint.env` are
  regular, single-link `root:plebeian-friday 0640` files installed by
  create-new plus fsync; the last two depend on separately approved live
  identities and must not be guessed;
* `browser-r20-pins.json` is a create-once regular single-link
  `root:plebeian-friday 0640` file. Its exact SHA-256 is
  `POC_FRIDAY_BROWSER_PINS_SHA256` in `friday.env`; the site refuses public
  browser readiness unless these independent release pins exactly match the
  loaded network manifest;
* systemd units are regular `root:root 0644` files, disabled at staging;
* the release tree and every release file are `root:root`, with directories
  `0755`, executables `0755`, and public receipts/templates `0644`.

Rendering still requires externally reviewed values for every token, exact
SHA-256 pins for the bound manifest/runtime binding, a proven Python 3.12 and
Nutshell dependency tree, and loader/glibc/libgcc checks. Those are explicit
host-inventory gates, not defaults supplied by these templates.
`browser-r20-pins.json.example` must be rendered only from the authenticated
Comet/DKG result, canonicalized once, installed create-new, and hashed into
`friday.env`; request data and `/api/config` are never pin sources.

The fresh DKG public-input sequence is intentionally split by ownership.
Root may create the service-owned `frost-v2` 0700 parent and `r20-inputs`
directory. A reviewed root action may coordinate the pre-enrollment step, but
only by invoking the fixed writer as `plebeian-friday`; root must not create the
host pin, fresh profile, predecessor copy, or any other file inside those
service-owned directories. After service enrollment creates `keyset-v2` and
its identities, the public V2 enrollment composition produces the fresh
manifest, its digest, and the bound manifest. The fixed
`friday-r20-public-input-writer.py` must then run as `plebeian-friday`, consume
only bounded public stdin with an independently approved SHA-256, and create
`keyset-v2/manifest.json`, `r20-inputs/bound-manifest.json`, then the exact
64-lowercase-hex-plus-newline `keyset-v2/owner-approved-manifest-digest.txt`
commit marker. All three are create-once 0600 files selected through checked
directory descriptors with `O_EXCL|O_NOFOLLOW` and fsynced before any DKG
stage. The root-owned 0600 operator predecessor copy remains unchanged.

The exact-build receipt supplies the hashes for these release files. Install
the following executable names at `<release>/bin/<name>` with `root:root 0755`:
`coco-demo-frost-participant-3of4`, `coco-demo-frost-public-inspect`, `fips`,
`fipsctl`, `plebeian-auctions-poc`, `plebeian-friday-authority`,
`plebeian-friday-comet-probe`, `plebeian-friday-coordinator`,
`plebeian-friday-r20-abort-composer`, `plebeian-friday-r20-abort-seal`,
`plebeian-friday-r20-acceptance-operator`, `plebeian-friday-r20-courier`,
`plebeian-friday-r20-enrollment`, `plebeian-friday-r20-host`,
`plebeian-friday-r20-permission-seal`, `plebeian-friday-signer`, and
`plebeian-friday-terminal-executor`. Install `friday-browser.js` at
`<release>/share/friday-browser.js` as `root:root 0644`; it must equal the
browser source embedded in `plebeian-auctions-poc`. Install this verifier and
the already pinned FIPS identity verifier in `<release>/bin/` as
`root:root 0755`. Install `friday-r20-public-input-writer.py` there as
`root:root 0755`; it refuses uid 0 and accepts no caller-selected destination.
No name is loaded from an older candidate directory.

The seven unit sources map one-for-one to
`/etc/systemd/system/<source-name>` as `root:root 0644`. A release action must
refuse an unexpected existing file rather than overwrite it silently, verify
the stopped/disabled state, and run `systemd-analyze verify` before any later
daemon reload.

`POC_FRIDAY_BROWSER_READY=false` is mandatory through staging and private
acceptance. The R20 fault operator accepts only an externally pinned,
time-bounded approval naming deployment `friday-demo-20261023-r20`; it cannot
consume an R14 approval.

The seven unit templates here are the complete R20 unit set. The common slice
remains byte-identical and is included by hash in the release action rather
than copied to a second filename.

## Nginx modes and public-disabled staging

`nginx-server.conf.example` renders to
`/etc/nginx/sites-available/plebeian-friday-r20.conf`. The normal and recovery
templates render to regular `root:root 0644` files beneath
`/etc/nginx/plebeian-friday-r20-modes/`. Exactly one mode is copied to a
create-new temporary file, fsynced, and atomically renamed onto the regular
`/etc/nginx/plebeian-friday-r20-active.conf`; modes are never symlinked or
co-loaded. Each mode is complete and contains its own `/v1/`, `/api/friday/`,
and `/` policy. Recovery mode denies issuance while retaining only the listed
recovery routes.

Staging leaves `/etc/nginx/sites-enabled/plebeian-friday-r20.conf` absent, so
the public origin is disabled by default. A later activation must render the
already inventoried TLS certificate paths, select a mode, create a regular
enabled copy, run `nginx -t`, and receive separate approval before reload.
`nginx-resource.conf` installs only as
`/etc/systemd/system/nginx.service.d/plebeian-friday-r20.conf` on the application
host. Wednesday server files, units, ports, and certificates are never edited.


## Exact signer auxiliary state confinement

The signer also writes its independent auxiliary state under
`/var/lib/plebeian-auctions-friday/r20/node-N`, where N is the exact
`FRIDAY_SLOT` (1–4) on that host. This directory must remain separate from
`frost-v2/keyset-v2/state`; never move its anchor into a nonce-state snapshot.
A separately approved provisioning action must first verify the selected
path is unused or already matches the approved state; it may then create the
selected service-owned `0700` directory. No automatic cleanup, re-enrollment,
parent-wide permission, or claim about existing host contents is implied.

The offline `render-friday-signer-state-dropin.py --slot N` reads only bounded
public V3 application JSON from stdin and emits the exact drop-in to stdout.
Install that renderer beside `verify-friday-runtime-target.py` in the reviewed
release's `bin/` directory if rendering from installed artifacts. A separately
approved installer must exclusively install the rendered text at
`/etc/systemd/system/plebeian-friday-signer.service.d/20-r20-state.conf` as a
regular `root:root 0644` file beneath a root-owned non-writable directory.
It must refuse unexpected existing content, inspect every effective unit and
drop-in, and verify the effective unit before any daemon reload or start.
This is an additional required rendered file beyond the seven base units.

The drop-in resets `ReadWritePaths` and grants only the existing exact
`/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2` plus the one selected
`/var/lib/plebeian-auctions-friday/r20/node-N`. It never grants the `r20`
parent, other slots, the whole Friday tree, coordinator paths or `/var/lib`.
`ProtectSystem=strict`, `ProtectHome=yes`, `UMask=0077` and `Restart=no` remain
in force. Do not use `${FRIDAY_SLOT}` in `ReadWritePaths`: the emitted paths
are literal. The startup verifier rejects a missing, mismatched, symlinked,
wrong-owner or wrong-mode directory/drop-in before the signer starts. These
source contracts are not proof of a deployed systemd namespace; a disposable
sandbox smoke and actual effective-unit review remain separate gates.
