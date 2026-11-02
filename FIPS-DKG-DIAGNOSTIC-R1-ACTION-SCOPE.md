# FIPS DKG Diagnostic R1 action scope

## Purpose

R3 failed with `SIGILL` in the DKG leader before namespaces or FIPS services started. The unprivileged R4 comparison then completed one modern and one baseline DKG; the modern binary was byte-identical to R3. This packet tests only the remaining privileged-controller/`setpriv` boundary with a fixed sanitized phase journal.

It does **not** claim the fault is fixed and does not authorize a full FIPS lab rerun.

## Differences from the passing unprivileged R4 comparison

| Property | Passing R4 | This diagnostic / R3-compatible boundary |
|---|---|---|
| Parent | UID 1000 Codex sandbox | root Python controller from owner terminal |
| Child transition | already UID/GID 1000 | `setpriv` changes root child to UID/GID 1000 |
| Groups/capabilities | inherited sandbox state | groups cleared; inheritable, ambient and bounding capabilities removed |
| Privilege state | sandbox policy | `no_new_privs`; no file capabilities |
| Working directory | repository | fixed `/home/maximoto`, matching the reported R3 shell run |
| Environment | clean diagnostic environment | exact R3 `env -i` allowlist |
| Limits | core 0, file 10 MiB, nofile 256, nproc 128 | same values, applied after `setpriv` |
| `nproc` accounting | existing UID 1000 process/thread population | same real UID pool after the root-to-UID transition; exact population is time-dependent |
| Run root | UID 1000, mode 0700 | root:GID1000 mode 0770; node/runtime children UID/GID1000 mode 0700 |
| DKG executable | R4 `/tmp` copy | new root-owned `/var/lib` staged path |
| Host execution | Codex sandbox/WSL2 | owner terminal/WSL2 without Codex sandbox |

Static review cannot determine whether the prior trap depended on the transition, a time-dependent UID thread/process condition, the staged path/root permissions, or a transient Bun/WSL2 event. The journal narrows any future failure without exposing protocol data.

## Exact requested root actions

1. Create one new root-owned staging directory and install the pinned controller, manifest and three executable files.
2. Run the controller once as root beneath the pinned GNU `timeout`: soft `TERM` at five minutes, forced `KILL` one minute later. The DKG child itself is limited to four minutes, leaving an explicit normal cleanup/evidence reserve. A forced kill is an uncertain outcome requiring inspection.
3. The controller creates one root:GID1000 temporary directory, four UID/GID1000 node directories and one fixed application file.
4. It generates disposable fake-demo DKG/RPC identities inside that temporary root.
5. It launches no namespaces, FIPS services, validators, mint, network listener or outbound connection.
6. It deletes only the positively identified temporary root, and only after proving its owned process group absent.
7. Before child launch it reserves one sanitized evidence file inside the root-only staging tree, avoiding any public-`/tmp` output race.

No sudoers, SSH, firewall, route, DNS, service, persistent credential, VPS or production artifact changes are included.

## Evidence and prior preservation

- R2/R3 staging and failure evidence remain immutable.
- R4 comparison evidence remains immutable.
- A single new outcome JSON is atomically finalized under the staging tree's mode-0700 `evidence/` directory, mode 0600 root-owned.
- The staging tree remains after the attempt so its exact bytes can be audited.

Independent review and a new exact owner action-time approval are required before staging or execution.
