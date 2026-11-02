# Friday R18 staging amendment R1

Status: **PREPARED AFTER A KNOWN PRE-STAGE REFUSAL; NOT REVIEWED, NOT
APPROVED, AND NOT EXECUTED**.

This is a narrow amendment to
`FRIDAY-R18-DKG-CEREMONY-ACTION.md` (SHA-256
`d48e1592ed9e8753e05d4edf66be0309f9cd26cd3ebd3c7784bf4214a0a7a29a`).
It does not authorize or perform a retry. If independently accepted and
freshly approved, it would continue the same R18 ceremony from the exact
preserved pre-stage state described below. Every custody rule, all-four
barrier, command, timeout, stop condition and exclusion in the original action
remains unchanged.

## Why the stable bin directory is required

The compiled host controller's production profile hard-codes these protected,
canonical, non-symlink executable paths:

```text
/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant
/opt/plebeian-auctions-friday/bin/coco-demo-frost-public-inspect
```

The reviewed action also pins the host controller invocation at:

```text
/opt/plebeian-auctions-friday/bin/plebeian-friday-dkg-host
```

The controller opens participant/inspector binaries with `O_NOFOLLOW`, hashes
them against the authenticated manifest immediately before use, requires a
root-owned non-writable canonical parent chain and later revalidates the same
device/inode/size/timestamps before spawn. A symlink from a versioned release
is therefore deliberately invalid. Moving the controller invocation to a
release directory would also change the independently reviewed argv and is not
a narrow staging correction. The existing root-owned `releases/` directories
are preserved and unused by this amendment.

## Known preserved state

The stopped execution performed no DKG host stage and created no courier root,
manifest destination, pairwise key, transport file, journal, lock, FROST share
or service. It created only the existing root-owned mode-`0700` action root on
each host and copied reviewed staging bytes into it.

The following fresh read-only audit was completed on all four fixed hosts after
the refusal. No private enrollment file was read or hashed.

| check | V1 | V2 | V3 | V4 |
|---|---|---|---|---|
| `/opt/plebeian-auctions-friday` | root:root `0755` | root:root `0755` | root:root `0755` | root:root `0755` |
| `releases/` | root:root `0755`, preserved | root:root `0755`, preserved | root:root `0755`, preserved | root:root `0755`, preserved |
| `bin/` | **absent** | root:root `0755` | **absent** | **absent** |
| host controller destination | absent | absent | absent | absent |
| participant destination | absent | absent | absent | absent |
| inspector destination | absent | exact retained file | absent | absent |
| manifest and digest-pin destinations | absent | absent | absent | absent |
| transport, journal, lock, attempt record | absent | absent | absent | absent |
| action-root filesystem | `/dev/sda`, ext4, rw | same | same | same |
| `/opt` filesystem | `/dev/sda`, ext4, rw | same | same | same |

The V2 retained inspector is root:root `0755`, regular, single-link, 724232
bytes and hashes to
`ee880c7f376a8d8b2ba6b1dde6388f64b0de36c0857371f656ebabe055d18b0f`.
It must not be overwritten.

The exact action-root entries are:

- V1/V3/V4: `plebeian-friday-dkg-host`,
  `coco-demo-frost-participant-3of4`,
  `coco-demo-frost-public-inspect`, `manifest.json`, and
  `owner-approved-manifest-digest.txt`.
- V2: the same set except the already retained inspector is not duplicated.

Every staged file is root:root, regular, single-link and below the root-only
`0700` action root. Fresh post-refusal hashes and sizes are:

| staged name | SHA-256 | size |
|---|---|---:|
| `plebeian-friday-dkg-host` | `f7b3923f4829acc7a837dc5fa54fe6f332003797dd560e9920bb58ab501baa4c` | 98653257 |
| `coco-demo-frost-participant-3of4` | `ed2014392707a00387570a56708e32dc7f7a50e3ab3acb11fb58672d75c7e578` | 2381144 |
| `coco-demo-frost-public-inspect` | `ee880c7f376a8d8b2ba6b1dde6388f64b0de36c0857371f656ebabe055d18b0f` | 724232 |
| `manifest.json` | `3c165d655a5a3332fe750a812e499b49c354456c230f175884c19e7e0b1a2985` | 4086 |
| `owner-approved-manifest-digest.txt` | `ba27aae87f25ca1d24482c845c60d9647ff4a36939ad84849f92786ca361c57c` | 65 |

All hosts expose the pinned ELF interpreter
`/lib64/ld-linux-x86-64.so.2`, `libc.so.6` and `libgcc_s.so.1`; `ldd` found no
missing library for the participant or inspector. The Bun host controller is a
Linux x86-64 dynamic executable with that same interpreter. `/usr/bin/setpriv`,
Python 3.12, `sha256sum`, `stat`, `install`, `ldd`, `file` and `findmnt` exist.
`/usr/bin/readelf` is absent and is neither installed nor required. No package
installation is permitted.

## Exact amended preflight

Before any new effect, rerun the original fresh access, SSH host-key, signed
enrollment/pin, Wednesday PID/restart, resource, process/listener and private
metadata checks. Additionally require all facts and all exact staged hashes
above. Require the local courier root still absent.

Refuse the whole continuation if an action-root entry is missing, added,
replaced, non-regular, multi-linked, not root-owned or hash/size mismatched; if
any final destination or attempt record unexpectedly exists; if V2's retained
inspector differs; or if a V1/V3/V4 `bin/` path exists at all. An absent path,
elapsed time or prior refusal never authorizes cleanup or regeneration.

## Exact amended promotion

Only after a fresh owner approval of this exact amendment:

1. Reopen the local helper
   `scripts/friday-r18-staged-promote.py`; require SHA-256
   `2563ebc98016f5382f367ea48fac04c3925dfbc4db3fac419a9453a0a4fab919`.
   Stream those exact bytes over the pinned SSH connection directly to
   `/usr/bin/python3 -I -S -B -`; do not install or rewrite the helper on a
   validator. The companion machine-readable action manifest contains the
   literal four argv arrays and binds this helper hash plus this document's
   exact SHA-256. The helper accepts no filesystem path or artifact hash from
   its caller.
2. The helper completes every check in **Exact amended preflight** before its
   first effect. It then creates and fsyncs a distinct, create-exclusive
   `promotion-amendment-r1.claim.json` below the preserved action root. The
   claim binds slot, current boot ID, original action SHA, owner-approved
   amendment-document SHA, helper SHA, all staged hashes, manifest digest and
   final destinations. Once created, any error or lost response makes the host
   indeterminate; do not rerun it.
3. On V1, V3 and V4, use `mkdir(2)` with mode `0755` to create exactly
   `/opt/plebeian-auctions-friday/bin` under the already verified root-owned
   `0755` parent. Creation must be exclusive: `EEXIST` is a refusal. Reopen it
   with `O_DIRECTORY|O_NOFOLLOW`, require root:root `0755`, fsync it and fsync
   `/opt/plebeian-auctions-friday`.
4. On V2, create nothing. Reopen its existing `bin/` directory and require its
   recorded root:root `0755`, single canonical parent chain.
5. Copy from the preserved staged file descriptors to these exact destinations
   using `O_CREAT|O_EXCL|O_NOFOLLOW`; no `install` overwrite, rename-overwrite,
   symlink or caller-supplied path is allowed:

   ```text
   /opt/plebeian-auctions-friday/bin/plebeian-friday-dkg-host
   /opt/plebeian-auctions-friday/bin/coco-demo-frost-participant
   /opt/plebeian-auctions-friday/bin/coco-demo-frost-public-inspect  # V1/V3/V4 only
   /var/lib/plebeian-auctions-friday/frost/keyset-v1/manifest.json
   /var/lib/plebeian-auctions-friday/frost/keyset-v1/owner-approved-manifest-digest.txt
   ```

   Executables become root:root `0755`. Manifest and digest pin become
   `997:986` mode `0600`. Fsync every file and each destination parent.
6. Reopen every destination with `O_RDONLY|O_NOFOLLOW`; require regular,
   single-link files, exact ownership/mode/size/hash, protected canonical parent
   chains and unchanged staged sources. Revalidate ELF loader/libraries without
   executing a DKG command. Create and fsync one exact public-only
   `promotion-amendment-r1.complete.json`; preserve all staging bytes.
7. Only after all four authenticated promotion-completion records are captured
   and verified may the unchanged original action initialize the local courier
   and begin stage `enroll`. No host may enter a DKG stage while another host's
   promotion is incomplete.

Any promotion error, SSH loss, host reboot or uncertain response stops all
hosts. Preserve the claim, staging and any create-exclusive final files; do not
retry, delete, overwrite, finish a partial host or initialize the courier
without separately reviewed inspection/recovery authority.

## Complete remaining-prerequisite conclusion

The audit found no further missing destination parent or runtime dependency:

- V1/V3/V4 need only the one exact `bin/` directory creation above.
- V2's exact `bin/` parent and retained inspector are already valid.
- All service-owned keyset/exchange parents already exist with their required
  `0700` ownership/modes.
- All operator action parents and preserved staging roots exist root:root
  `0700`.
- All five staged artifact types are present where required and hash exactly.
- Final executable, manifest, pin, transport, journal, lock and attempt paths
  remain absent.
- The action and `/opt` parents share the same ext4 filesystem on every host,
  though the corrected copier does not rely on cross-directory rename.
- Existing Wednesday services remain outside every Friday destination.

This conclusion covers staging and the already reviewed ceremony executable
dependencies. It is not evidence that the real DKG will succeed and it does
not authorize a DKG command, service, listener, cleanup or deployment.

## Local regression evidence

`scripts/friday-r18-staged-promote.test.py` has SHA-256
`5c2f0f18e4d1ae267f3c757dd4785cb6e6eff7c726dda4d78025a05ac898f157`.
Five isolated temporary-directory tests pass under Python 3.12: missing-bin
creation and exact promotion, exact retained-inspector preservation, bad staged
hash refusal before claim, unexpected-entry refusal before claim, and
pre-existing-bin refusal before claim. `py_compile` passes for helper and test.
These tests create no remote file, secret, listener or DKG state.
