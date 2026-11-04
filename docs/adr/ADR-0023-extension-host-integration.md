# ADR-0023: Extension Host Integration — Host Ports, Actions, and Relay Access

## Status

Proposed — branch `feat/cms-spike`

## Date

2026-10-28

## Related

- ADR-0021: Three-Part SDK, UI, and Platform Architecture (defines where
  extensions live; this ADR defines how they run)
- ADR-0002: NDK → Applesauce Nostr I/O migration (relay I/O seam)
- ADR-0005: No External Service Dependencies in Tests
- ADR-018: Instance Configuration and Self-Hosting Boundary (secrets stay in
  the server environment)
- Current code: `sdk/core/extensions/extension.ts`,
  `platform/extensions/registry.ts`, `sdk/core/ports/nostrRelay.ts`,
  `platform/server/buildServer.ts`, `platform/server/http/config.ts`,
  `contextvm/server.ts` (existing ContextVM MCP server)
- External: Routstr API reference — `https://docs.routstr.com/api/overview/`
- Prior art for the extension store (§7.0): LNbits extensions
  (`github.com/lnbits/lnbits`, `github.com/lnbits/lnbits-extensions`) and
  StartOS packages and registries (`github.com/Start9Labs/start-technologies`)

## Context

ADR-0021 puts the extension _contract_ in the SDK and the extension _runtime_
in Platform. Part of that exists today:

- `sdk/core/extensions/extension.ts` defines `ExtensionManifest` (id, version,
  capabilities, runtimes, `publicConfig` / `privateConfig` schemas),
  `ExtensionLifecycle.start/stop`, and `parseExtensionConfig`, which never
  attaches private parse errors so secrets are not echoed.
- `platform/extensions/registry.ts` provides a per-instance `ExtensionRegistry`
  that validates settings atomically, starts extensions per runtime, withholds
  `privateConfig` from the `client` runtime, and exposes
  `getPublicDescriptors()` for public config.

Three things are missing, which is why no real extension can be built yet:

1. **No host ports.** `ExtensionContext` carries config and an `AbortSignal`,
   nothing else. An extension that needs to read relays or call a provider must
   import NDK, `fetch`, or app stores directly. That is the cross-boundary,
   unscoped-egress coupling ADR-0021 forbids.
2. **No invocation path.** A client UI cannot ask a server-side extension to do
   something. The registry is not wired into `buildServer.ts`, and
   `/api/config` does not publish extension descriptors.
3. **No caller identity.** Server HTTP routes currently do not authenticate
   callers (verified: no `Authorization` handling under
   `platform/server/http/`). A server extension that spends operator money
   cannot be exposed without knowing who is asking.

### Driving example: AI product description

A seller writing a product listing clicks "Suggest description". The suggestion
comes from an LLM via **Routstr**, which exposes an OpenAI-compatible API
(`POST {base}/v1/chat/completions`), authenticated with an `sk-…` API key or a
Cashu token as a bearer credential, and returns `402` on insufficient balance.
The operator holds the Routstr key; it is configured in the host and must never
reach a browser.

The example covers each integration point:

| Need                                   | Integration point                      |
| -------------------------------------- | -------------------------------------- |
| Operator secret (Routstr key)          | `privateConfig`, server runtime only   |
| Seller clicks a button in product form | UI slot + client → server action       |
| Know the caller is a seller            | Authenticated action request           |
| Ground the prompt in seller context    | Scoped, read-only relay access         |
| Call Routstr                           | Scoped HTTP egress to an allowlist     |
| Put text into a listing                | Returned draft; **seller** signs/posts |
| Test without spending sats             | Egress port pointed at a local fake    |

### Wrong approaches

- **Call Routstr from the browser with the operator key.** This leaks the
  credential to every visitor. Rejected outright.
- **Have each seller paste their own Routstr key or Cashu token in the client.**
  This is a valid future mode, but it is a different trust model (user-funded,
  client runtime). It does not solve the operator-configured case and is out of
  scope here.
- **Let server extensions import NDK, `fetch`, or the app signer directly.**
  This is unscoped egress and an implicit relay set. A server extension holding
  the app key could also sign arbitrary events as the marketplace. Rejected.
- **Let the extension publish the generated description.** The seller is the
  author of their listing. An extension writing to relays on their behalf, or
  as the app key, makes the app the author of user speech (same objection as
  ADR-019). Rejected.

## Decision

Extensions interact with the outside world **only through host ports injected
via `ExtensionContext`**. Clients reach server-side extension logic **only
through declared, authenticated actions** routed by Platform, over HTTP with
NIP-98 or, per action opt-in, as ContextVM tools. Extensions return data; users
sign.

### 1. Host ports (SDK contract, Platform implementation)

Extend `ExtensionContext` with an optional, capability-gated `host` object. The
SDK defines the port interfaces; Platform constructs scoped instances per
extension. A port is present only if the manifest requests it and the operator
setting enables it.

```ts
interface ExtensionHostPorts {
	relays?: ScopedRelayPort // wraps NostrRelayPort with a fixed relay list
	http?: ScopedHttpPort // fetch restricted to declared origins
	storage?: KeyValueStoragePort // namespaced to the extension id
	log: ExtensionLogger // redacts privateConfig values
}
```

- **`relays`:** built on the existing `NostrRelayPort`, with relay URLs bound by
  Platform from instance config. The extension cannot pass its own relay list.
  Read is granted by `host:relays:read`. Publish (`host:relays:publish`) only
  accepts events that are already signed, and is not granted to any extension
  in this ADR.
- **`http`:** an egress port that rejects any origin not listed in the
  manifest's `egress` field, intersected with the operator's configured base
  URL. It has no ambient `fetch`, applies a per-request timeout, and caps
  response size.
- **No signer port.** No extension receives the app key or a user signer in this
  ADR. Signing remains in the client with the user's signer, or in existing
  Platform managers for app-signed events.

Manifests gain these declarative fields, validated by
`validateExtensionManifest`. `icon` is an optional logo: a root-relative path to
a bundled image (no `..`, no query) or an https URL. It is carried in public
descriptors, and an invalid icon is dropped rather than failing the descriptor.

```ts
hostPorts: readonly ('relays:read' | 'relays:publish' | 'http' | 'storage')[]
egress?: readonly string[] // https origins; http only for localhost
icon?: string // '/images/x.svg' or 'https://…'
```

### 2. Actions: the only client → server path

A server-runtime extension may declare named actions:

```ts
actions?: Record<string, {
	input: RuntimeSchema<In>
	output: RuntimeSchema<Out>
	auth: 'user' | 'admin'
	rateLimit: { perPubkey: number; windowSeconds: number }
	transports?: readonly ('http' | 'contextvm')[] // default ['http']
	inputJsonSchema?: JsonSchemaObject // published as the MCP tool inputSchema
	handler(ctx: ExtensionContext, input: In, caller: ExtensionCaller): Promise<Result<Out, SdkError>>
}>

interface ExtensionCaller { pubkey: string; isAdmin: boolean; transport: 'http' | 'contextvm' }
```

Steps 1 and 4–7 below are transport-neutral and live in the SDK as
`executeExtensionAction`. An action that is not exposed on the caller's
transport is handled exactly like a missing action.

Platform mounts one route in `buildServer.ts`:

```text
POST /api/extensions/:id/actions/:action
```

The request is handled in this order:

1. Return 404 unless the extension is enabled and the action exists. Disabled
   and unknown extensions are indistinguishable.
2. Authenticate with **NIP-98 HTTP Auth** (kind 27235): verify the signature,
   the `u` and `method` tags, a payload hash over the body, and a `created_at`
   skew of ±60s. For `auth: 'admin'`, also check the pubkey against the
   existing admin list.
   - NIP-98 is a standard NIP but new to this repository. Adopting it is part of
     this decision, not existing behavior.
   - The `u` tag must equal the request path and query under an accepted
     origin: the origin of `INSTANCE_SITE_URL`, plus the request origin in
     `development` only. The request origin comes from the client-controlled
     `Host` header, so trusting it elsewhere would let a header signed for one
     market be replayed on another. Outside development, an instance without
     `INSTANCE_SITE_URL` rejects every action call, and logs that at startup.
   - Accepted event ids are remembered for the skew window, so a captured header
     cannot be replayed. Bodies are capped at 64 KB.
3. Apply the per-pubkey rate limit. Exceeding it returns 429.
4. Parse the body with `input`. Validation failure returns 400 without echoing
   the body.
5. Call the handler with the scoped context and an `AbortSignal` tied to the
   request.
6. Parse the handler result with `output` before responding. Provider responses
   are untrusted.
7. Map known errors to statuses: provider insufficient balance becomes 503
   `extension_unavailable`, never 402. That keeps operator funding state out of
   buyer and seller payment UI.

Errors returned to the client never include `privateConfig` values, provider
error bodies, or prompts.

### 2a. ContextVM transport

Actions may also be exposed as ContextVM (MCP over Nostr) tools. This is a
second transport for the same action contract, not a second contract.

- **Opt-in per action.** An action is exposed over ContextVM only if its
  `transports` includes `'contextvm'`, and only if the operator enables
  ContextVM exposure for that extension. The default is HTTP only, because
  ContextVM servers in production announce to public relays and their tools
  become globally discoverable.
- **Tool naming.** The tool name is `ext.<extension-id>.<action>`. The `ext.`
  prefix separates extension tools from first-party tools such as
  `get_btc_price`. Action names never contain dots, so the name parses
  unambiguously. Tool names are capped at 128 characters.
- **Caller identity.** The request is a signed Nostr event, so it replaces NIP-98
  on this transport. The server transport runs with `injectClientPubkey: true`,
  and Platform reads the caller only from `_meta.clientPubkey`, which the
  transport overwrites with the signed event's pubkey. Without that option, the
  value is client-controlled and must not be trusted.
- **Same pipeline.** Lookup, transport gating, admin check, input parsing,
  handler, and output parsing run through the same `executeExtensionAction` as
  HTTP. The per-pubkey rate limit is one budget per action across both
  transports, not one budget per transport.
- **Same envelope.** `structuredContent` (and a JSON text copy in `content` for
  older clients) carries the same `{ ok, value }` / `{ ok: false, error: { code,
message, retryable } }` body as HTTP. Errors set `isError: true` and carry
  only the public code and message. Provider balance errors are still
  `extension_unavailable`.
- **Exposure policy.** Tools with `auth: 'user'` accept any pubkey, like the HTTP
  route, so they are added to the transport's `excludedCapabilities` for the
  pubkey allowlist. Tools with `auth: 'admin'` are still checked against the
  admin list by the pipeline.
- **Client.** The SDK provides `invokeExtensionActionOverContextVm(callTool, id,
action, input)`. `callTool` is injected from an MCP client over a ContextVM
  `NostrClientTransport`, so the SDK does not depend on `@contextvm/sdk`. Tool
  arguments must be a JSON object.

### 3. Discovery and UI

- `/api/config` adds `extensions: PublicExtensionDescriptor[]` from
  `registry.getPublicDescriptors()`. The response includes action names and
  their public metadata, and never private config.
- UI renders extension affordances by **capability**, not extension id. The
  product form shows "Suggest description" when a descriptor advertises
  `product.description.suggest`. This lets an operator swap Routstr for another
  provider without UI changes.
- The SDK provides a typed client, `invokeExtensionAction(id, action, input,
signer)`, which builds the NIP-98 header with the user's signer. UI calls it;
  UI does not hand-roll requests.
- Descriptors list each action's `transports`. ContextVM tool listings come from
  `describeExtensionActionTools()` and include only actions that opted into
  `contextvm`.

### 4. Lifecycle wiring

- The server entrypoint calls `startExtensions()` (`platform/server/extensions.ts`).
  It creates one `ExtensionRegistry` per instance, registers the built-in
  definitions (`platform/extensions/builtins.ts`), and calls `configure()` from
  server environment settings (ADR-018). Private values come only from the
  environment, never from relay events or `/api/setup` payloads. It then calls
  `start('server')`, and `stop()` on shutdown.
- Environment variables map to config like this:

  | Variable                        | Meaning                                                                                            |
  | ------------------------------- | -------------------------------------------------------------------------------------------------- |
  | `EXTENSION_<ID>_ENABLED`        | `true` enables the extension. Otherwise it stays disabled.                                         |
  | `EXTENSION_<ID>_PUBLIC_<FIELD>` | `publicConfig.<field>` (camelCased).                                                               |
  | `EXTENSION_<ID>_<FIELD>`        | `privateConfig.<field>`. Private is the default, so a misnamed secret never reaches `/api/config`. |
  | `EXTENSION_<ID>_EGRESS`         | Operator egress allowlist, intersected with the manifest's `egress`.                               |
  | `EXTENSION_<ID>_HOST_PORTS`     | Operator port grants. Defaults to every port the manifest requests.                                |

  `<ID>` is the extension id uppercased with `.` and `-` replaced by `_`. Values
  are strings, so config schemas coerce them (for example
  `z.coerce.number()`). Two ids that map to the same prefix are both refused.

- A configuration error disables that extension and is logged by id, but it does
  not prevent the marketplace from booting. Extensions are optional by
  definition.

### 5. Reference extension: `ai-product-description`

```ts
defineExtension({
	manifest: {
		id: 'ai-product-description',
		version: '0.1.0',
		displayName: 'AI product description',
		capabilities: ['product.description.suggest'],
		runtimes: ['server'],
		hostPorts: ['relays:read', 'http'],
		egress: ['https://api.routstr.com'],
		publicConfig: z.object({ maxChars: z.number().int().min(100).max(4000).default(1200) }),
		privateConfig: z.object({
			apiKey: z.string().regex(/^(sk-|cashu)/),
			baseUrl: z.string().url().default('https://api.routstr.com/v1'),
			model: z.string().min(1),
		}),
	},
	actions: { suggest: { auth: 'user', rateLimit: { perPubkey: 10, windowSeconds: 3600 } /* … */ } },
})
```

Configured from the host environment:

```text
EXTENSION_AI_PRODUCT_DESCRIPTION_ENABLED=true
EXTENSION_AI_PRODUCT_DESCRIPTION_API_KEY=sk-…        # private, never logged
EXTENSION_AI_PRODUCT_DESCRIPTION_BASE_URL=https://api.routstr.com/v1
EXTENSION_AI_PRODUCT_DESCRIPTION_MODEL=<model-id>
```

Flow of the `suggest` action:

1. **Input:** `{ title, category?, tags?, notes?, productCoordinate? }`, where
   each field is length-capped.
2. **Seller context, from relays:** optionally read the caller's own kind 0
   profile and up to N of the caller's own kind 30402 listings via
   `host.relays`. The filter is pinned to `authors: [caller.pubkey]`, and
   events are parsed with the existing `src/lib/schemas/` parsers before use.
   - Unparseable events are dropped, never fed to the prompt.
   - DMs, orders, addresses, and other pubkeys' events are never read.
3. **Provider call:** `POST {baseUrl}/chat/completions` through `host.http`.
   The base URL origin must be in `egress`. If an operator configures a
   self-hosted Routstr node, it must be added to the operator egress allowlist.
4. **Output:** `{ description: string, model: string }`, truncated to
   `maxChars`, as plain text or restricted markdown, rendered through the same
   non-HTML path as ADR-019 text blocks.
5. **Client:** inserts the text into the product form draft as an editable
   suggestion. Nothing is published until the seller saves the product, which
   uses the existing signed kind 30402 flow. No new event kind is introduced.

This is operator-funded inference. It is not a marketplace payment and does not
touch the order or payment lifecycle states.

### 6. Test isolation (ADR-0005)

The Routstr call happens on the server, so `page.route()` cannot intercept it.
The `http` port is the seam instead:

- **Unit:** construct the extension with a fake `ScopedHttpPort` and a fake
  `ScopedRelayPort`. Assert prompt construction, own-author filtering, parser
  gating, truncation, and error mapping (401 → misconfigured, 402 →
  `extension_unavailable`, timeout → retryable).
- **E2E (feature gate):** the spec starts a local OpenAI-compatible fake on
  localhost. The dev server is launched with `…_BASE_URL=http://localhost:<port>/v1`
  and a dummy `sk-test…` key. `egress` permits `localhost` only when the stage is
  not production. The spec drives product form → "Suggest description" → edit →
  publish, and records video per the Feature Quality Gate.
- No test reaches `api.routstr.com`.

### 7. Extension store

The extension store is a per-instance **admin surface** for browsing,
installing, configuring, and disabling extensions. It is modeled on two
existing self-hosted extension ecosystems, LNbits and StartOS (Start9). It
borrows their distribution and lifecycle ideas, but not in-process code
loading.

#### 7.0 Prior art

Sources, checked 2026-10-30: LNbits `docs/devs/extensions.md`,
`lnbits/core/models/extensions.py` on `main`, and the
`lnbits/lnbits-extensions` `extensions.json` index; StartOS
`projects/start-sdk/docs/src/` (`manifest.md`, `actions.md`, `tasks.md`,
`dependencies.md`, `host-registry*.md`) in `Start9Labs/start-technologies`.

**LNbits:**

- **Catalog:** admins add "Extension Sources", which are URLs of `manifest.json`
  indexes (or the `LNBITS_EXTENSIONS_MANIFESTS` environment variable). Each
  index lists releases: `id`, `version`, `min/max_lnbits_version`, `archive`
  (zip URL), sha256 `hash`, `icon`, `details_link`, and optionally `pay_link` /
  `paid_features`. Several releases per id are listed, and the host picks a
  compatible one.
- **Install:** the archive is downloaded and its hash checked. The Python code
  runs in-process, with its own routes (`/<ext>/api/...`), UI pages, and
  database migrations.
- **Enablement has two levels.** An admin installs and activates the extension
  server-wide. Each user then enables it for their own account
  (`UserExtension.active`), optionally pay-to-enable.
- **Main is moving to sandboxing.** It now models a WASM runtime with metered
  host calls (HTTP, storage, wallet counters, runtime limits) and per-user
  **permission grants with policy**. For example, a background payment grant
  carries `max_amount` and a `own_wallets_only` / `external_allowed`
  destination policy.

**StartOS:**

- **Catalog:** multiple independent **registries** that anyone can run.
  Packages (`.s9pk`) are signed. A registry admin scopes **signers** to specific
  packages, and an index entry is `(package id, version, sighash)`. Sideloading
  is possible.
- **Manifest:** id, title, license, package and upstream repos, marketing and
  donation URLs, short and long descriptions (≤120 / ≤2000 characters, enforced
  at pack time), volumes, images, and dependencies.
  - Dependencies carry version ranges, `kind: 'running'`, and health checks, and
    can be optional or conditional.
  - Updates can carry a pre-download alert keyed to the installed version.
- **Actions** have typed input forms and typed results (`single` / `multiline` /
  `group`, with `masked` values). Visibility is `user`, `dependent`, or
  `public`, and the handler knows its caller (a package id, or `null` for the
  user).
- **Tasks** prompt the user to run an action. A `critical` task blocks the
  service from starting until it is done, for example setting credentials.
- **Isolation:** each service runs in its own container with declared volumes,
  and services expose health checks.

**What we adopt, adapt, or reject:**

| Idea                                       | Source         | Decision for Plebeian Market                                                                                                                                                                             |
| ------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator-chosen catalog sources            | LNbits, Start9 | **Adopt** as _registries_ (7.2). Default is none for remote entries.                                                                                                                                     |
| Signed entries, signer scoped per package  | Start9         | **Adopt via Nostr.** Remote entries are signed by the ContextVM server key. Registries are curator pubkeys the operator trusts.                                                                          |
| Sideload by explicit identity              | Start9         | **Adopt.** An admin may add a remote server by pubkey, labeled _sideloaded_.                                                                                                                             |
| Release pin by hash                        | LNbits, Start9 | **Adapt.** Built-ins are pinned by the release itself. Remote bindings pin tool name plus an `inputSchema` hash (7.5).                                                                                   |
| Host-version compatibility range           | LNbits, Start9 | **Defer.** Built-ins compile with the host. Revisit if remote tools need a protocol version.                                                                                                             |
| Download and run extension code in-process | LNbits         | **Reject.** Code runs only if it is compiled in (built-ins) or hosted elsewhere (remote). LNbits' own move to WASM with metered host calls confirms that downloaded code needs a sandbox.                |
| Metered host calls, permission grants      | LNbits (main)  | **Adopt.** Host ports are the grant surface (§1). Each grant shows on the consent screen, and Platform counts calls per port for the admin view.                                                         |
| Two-level enablement (admin, then user)    | LNbits         | **Adapt** (7.6). The admin installs. Users opt in per capability as a client preference for data-flow consent, never as authorization.                                                                   |
| Pay-to-install / pay-to-enable             | LNbits         | **Reject for now.** It is a payment flow and needs its own decision (AGENTS.md payment-state rules).                                                                                                     |
| Typed action forms and results, `masked`   | Start9         | **Adopt in UI.** Action I/O stays schema-typed. Store config forms render from the config schemas, and private fields display like `masked`.                                                             |
| Action visibility and caller identity      | Start9         | **Already decided** (§2): `auth: 'user' \| 'admin'` and `ExtensionCaller`.                                                                                                                               |
| `critical` task blocks start until done    | Start9         | **Adopt** as the `needs_setup` state (7.3).                                                                                                                                                              |
| Health checks                              | Start9         | **Adopt** for remote bindings (`unreachable`). An optional built-in lifecycle health hook is follow-up SDK work.                                                                                         |
| Dependencies with version ranges           | Start9         | **Defer.** If needed, express dependencies by **capability**, not by extension id.                                                                                                                       |
| Pre-update alerts                          | Start9         | **Adapt.** When a release changes an extension's config schema, stored settings are revalidated at boot, and the extension shows `needs_setup` or `misconfigured` instead of starting with stale config. |
| Short/long descriptions with hard limits   | Start9         | **Adopt** for store entries: short ≤120 characters (aim for 80), long ≤2000, rendered as plain text or sanitized markdown.                                                                               |
| Per-extension database / volumes           | LNbits, Start9 | **Already decided:** the `storage` port is namespaced per extension.                                                                                                                                     |

The resulting shape is a **Start9-style registry model for discovery and
trust**, an **LNbits-style split between admin install and user activation**,
and **host ports in place of in-process code**. Host ports are the boundary
LNbits is now converging on with WASM.

#### 7.1 Built-in entries

- These are the definitions registered in the instance's `ExtensionRegistry`.
  This is the code compiled into the running Platform release, so the release
  is the pin.
- An entry shows only client-safe metadata:
  - id, version, display name, and short and long descriptions;
  - license and repository;
  - capabilities and runtimes;
  - requested `hostPorts` and `egress` origins;
  - action descriptors (name, auth, rate limit, transports);
  - config form fields derived from the `publicConfig` and `privateConfig`
    schemas, but **never private values**.

  The description, license, and repository fields require a small SDK manifest
  addition (implementation step 8).

#### 7.2 Remote entries and registries (ContextVM)

- **Entries** are third-party ContextVM servers, described by their existing
  announcements: kind 11316 (server announcement) and kind 11317 (tool list),
  as defined by `@contextvm/sdk`. No new event kind is introduced for entries.
- **Sources.** Following Start9, there is no global open catalog. An entry
  appears only through a source the operator added:
  - **Registry:** a curator pubkey the operator trusts, whose published list of
    ContextVM server pubkeys defines the entries. The list is a NIP-51 follow
    set: kind 30000, `d` = `plebeian-extension-registry`, and one `p` tag per
    ContextVM server pubkey. No new kind is introduced. Only the curator's
    newest validly signed list is used.
  - **Sideload:** a single server pubkey the admin enters directly. It is
    labeled _sideloaded_.
- Announcements are read only from operator-configured relays, and relay hints
  are not followed. Announcements are untrusted. They are parsed with a schema
  first, and unparseable ones are dropped with the failed constraint recorded
  for the admin.
- An entry shows:
  - the server pubkey and name, about/website, and the relays it was seen on;
  - the source it came through (which registry, or sideloaded);
  - its tools with their `inputSchema`.

  It is always labeled **third-party**.

- Tools that require payment (ContextVM payment flows) are listed as **not
  installable**. This is the same decision as rejecting LNbits' pay-to-enable.

#### 7.3 Install state

Each entry has one of these states, kept distinct:

| State                | Meaning                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `available`          | Listed, not installed.                                                                                  |
| `needs_setup`        | Installed, but required config is missing, or config must be revisited after an update. Does not start. |
| `installed_enabled`  | Installed, valid config, running (built-in) or bound and healthy (remote).                              |
| `installed_disabled` | Installed and configured, switched off by the admin.                                                    |
| `misconfigured`      | Config fails validation or start (built-in), or the bound tool no longer matches its pin (remote).      |
| `env_managed`        | Built-in extension configured by `EXTENSION_<ID>_*` environment variables. Read-only in the store.      |
| `unreachable`        | Remote, installed, but the server failed its last health check.                                         |

`needs_setup` corresponds to a Start9 `critical` task: the admin is told what
to do, and the extension cannot run until it is done. `misconfigured` means
something is broken, not merely unfinished.

#### 7.4 Installing a built-in extension

1. The admin opens the entry. Store routes are authenticated with NIP-98 and
   require the admin role.
2. A **consent screen** lists the grants: requested host ports, egress origins,
   and what data leaves the instance (for example, "seller-written text is sent
   to the configured model provider"). The admin must confirm it explicitly.
   This corresponds to LNbits permission grants.
3. The extension enters `needs_setup` until required config is provided. The
   admin fills in the config form. Platform validates it with
   `parseExtensionConfig`, which does not echo private values in errors.
4. Valid settings are written to the server-side settings store (7.8). Private
   fields are **write-only**: after saving, the UI shows only `set` / `not set`
   (like a Start9 `masked` value) and can replace a value, but never read it
   back.
5. Platform stops the running extensions, calls `configure()` with the new
   settings, and starts them again. An extension that fails to start becomes
   `misconfigured` without affecting the others.
6. `/api/config` descriptors update, so capability-gated UI appears.

Environment variables keep authority (ADR-018). If `EXTENSION_<ID>_*` is set,
the extension is `env_managed`. The store displays it but cannot change it, and
stored settings for that id are ignored.

On boot after a release, stored settings are revalidated against the new
schemas. An extension whose stored settings no longer parse enters
`needs_setup`, and it never starts with config that fails validation.

#### 7.5 Installing a remote extension

1. The admin selects a remote entry and the specific tools to bind. Each tool is
   mapped to a capability, for example `product.description.suggest`, so UI
   keeps rendering by capability.
2. The binding is **pinned**: server pubkey, tool name, and a hash of the tool's
   `inputSchema` as reviewed. This plays the role of the LNbits archive hash and
   the Start9 sighash. If a later announcement changes the tool, the binding
   becomes `misconfigured` and stops serving until the admin approves it again.
   Announcements are replaceable, so the instance must not pick up changes
   silently.
3. Clients call bound tools through the same action contract and the same route.
   - A binding is exposed as extension id `remote.<server-pubkey>`, under a
     kebab-case action name the admin chooses at binding time, because remote
     tool names need not follow action naming.
   - Platform calls the remote server as an MCP client over a ContextVM
     `NostrClientTransport`, using a dedicated instance client key. This key is
     not the app signing key, and it is never exposed to extensions.
   - The per-pubkey rate limit of the action applies before the remote call.
4. Remote output is untrusted. It is wrapped in the standard envelope, rendered
   as plain text only, and never auto-published. No `privateConfig` or operator
   secret is ever sent to a remote server.
5. Platform health-checks bound servers. Failures move the binding to
   `unreachable` until the next successful check.

#### 7.6 User activation

LNbits separates admin install from per-user enablement. Here, the admin
installs and enables an extension for the instance. Individual users then see
its capability, but for extensions that send user content to a third party, UI
asks the user to opt in once per capability before the first call.

- The opt-in records **data-flow consent**, not authorization. Authorization
  stays with the action's `auth` and the caller's pubkey.
- It is client-side preference state. It is not a payment, it is not published
  to relays by this ADR, and the server does not require it.

#### 7.7 Current implementation (read-only repository and built-ins)

- The Extensions admin page (`/dashboard/app-settings/extensions`) has an
  **Extension store** button at the top right. It opens the read-only store.
- The store reads `GET /api/extensions/catalog`. The request is authenticated
  with NIP-98 (a signed `GET` with no payload), and non-admins get `404`, so
  public visitors cannot see the store.
- **Repository tab (default).** It shows third-party extensions from registries
  (7.2):
  - Curators come from `EXTENSIONS_REGISTRY_CURATORS` (hex or npub), on top of
    the Plebeian default registry. The default's curator key is not chosen yet,
    so it is empty.
  - Relays come from `EXTENSIONS_REGISTRY_RELAYS`, which defaults to the app
    relay, so no other relay is contacted unless the operator opts in.
  - Platform reads the registry lists, then the listed servers' kind 11316 and
    11317 announcements. Every event is signature-verified and parsed as
    untrusted (`sdk/core/extensions/repository.ts`).
  - The result is cached for 5 minutes. After a relay failure Platform retries
    no sooner than 30 seconds, and the failure is shown to the admin.
  - Each entry shows its name, about text, version, an https-only logo and
    website, tools with input fields, and CEP-8 prices. Entries are labelled
    _Third-party_ and, if any tool is priced, _Paid_.
  - Listed servers with no valid announcement show as _Unavailable_ with the
    failed constraint. Curators with no list are reported.
  - **Sideload.** An admin can add a ContextVM server by hex pubkey or npub
    (`POST /api/extensions/sideloads`) and remove it
    (`DELETE /api/extensions/sideloads/:pubkey`). Both are NIP-98-authenticated
    and admin-only, and non-admins get `404`.
    - The entry is labelled _Sideloaded_ and described only by the server's own
      signed announcements, exactly like registry entries. Sideloading lists a
      server for review; it grants the server nothing.
    - Sideloads persist in a `bun:sqlite` file (`EXTENSIONS_STATE_PATH`,
      default `./data/extensions.sqlite`, git-ignored), capped at 50 servers.
      The file stores only the server pubkey, the admin pubkey that added it,
      and the time. It never stores secrets.
    - A change invalidates the repository cache. A relay read started before
      the change cannot overwrite the newer listing.
  - The tab is browse-only. Paid entries are marked as not installable, and
    binding remote tools (7.5) is not implemented.
- **Built-in tab.** It shows every extension compiled into this release.
- Each entry (`ExtensionCatalogEntry`, `sdk/core/extensions/catalog.ts`) shows:
  - logo, short description (manifest `description`, at most 120 characters),
    capabilities, and actions;
  - permissions in plain language (host ports and egress origins);
  - state: `installed_enabled`, `available`, or `misconfigured` with a
    private-safe reason;
  - the `EXTENSION_<ID>_` variables that enable it.
- Config values are never included. Every entry is `managedBy: 'environment'`.
- Remote bindings, `needs_setup`, `installed_disabled`, `unreachable`, and
  installing from the store are not implemented. The SQLite file above is a
  first, secret-free piece of the 7.8 settings store; storing private values
  there still needs the encryption and key-management decision.

#### 7.8 Settings store prerequisite

Installing from the store requires a server-side settings store with private
values encrypted at rest. Its design (location, key management, backup) is a
separate decision. **Until it exists, the store is read-only.** It can browse
built-in entries, registries, and sideloaded entries, and show `env_managed`
state, and installation stays environment-driven.

The store never writes extension settings, bindings, sources, or install state
to relays. Public visitors never see the store. They see only the resulting
capabilities in `/api/config`.

## Rules

- Extensions never import `@nostr-dev-kit/*`, `nostr-tools` relay classes, app
  stores, or `platform/*`. The existing `sdk/boundary.test.ts` and
  `platform/boundary.test.ts` are extended to cover `sdk/extensions/**`.
- Relay targets come from Platform, not the extension or the caller.
- Relay data reaching an extension is parsed with the kind's schema first
  (AGENTS.md "Event Validation Before Surfacing").
- Extension output is untrusted text. It is never HTML and never auto-published.
- `privateConfig` is reachable only inside server handlers. It is absent from
  `/api/config`, logs, error responses, and client bundles.
- Payment-state vocabulary is reserved for marketplace payments. Provider
  billing errors map to availability errors.
- ContextVM exposure is opt-in per action and per instance. Caller identity on
  that transport comes only from the transport-injected `_meta.clientPubkey`.
- The extension store installs by enabling, configuring, or binding. It never
  downloads or executes code.
- Store-managed private values are write-only. Environment configuration
  overrides store settings.
- Remote bindings are pinned to a reviewed tool definition, and they never
  receive operator secrets.

## Alternatives Considered

- **ContextVM as the _only_ action transport.** Rejected for now. ContextVM is
  adopted as a second transport (§2a), but browser UI keeps the HTTP route,
  which adds no relay round-trips and no dependency on relay availability for
  a simple form action.
- **Session cookies or API tokens instead of NIP-98.** This adds a login
  backend. NIP-98 reuses the signer every user already has. Rejected.
- **A generic "proxy any URL" host endpoint.** This becomes an open relay for
  operator credentials. Rejected in favour of declared actions with typed I/O.
- **Client-runtime extension with a user-supplied Cashu token.** This is a valid
  second mode with user-funded inference and no operator secret. It needs a
  separate decision on client token storage under the Cashu wallet ADR-0010.
- **Third-party plugin loading (dynamic import from URL), as LNbits does with
  extension archives.** Out of scope. Extensions are first-party modules
  compiled into Platform until a sandboxing decision exists. LNbits' own move
  toward a WASM runtime with metered host calls shows what that decision has to
  cover. If it is ever made, the host ports in §1 are the import surface such a
  sandbox would expose.
- **A global open catalog of every ContextVM announcement.** Rejected. Following
  StartOS registries, entries appear only through registries the operator
  trusts or explicit sideloads.

- **Publishing the store catalog or install state as Nostr events.** Rejected.
  Install state includes private configuration and operator decisions that do
  not belong on relays. Remote discovery reuses existing ContextVM announcement
  kinds instead of a new catalog kind.
- **Letting the browser call remote ContextVM extensions directly.** Deferred.
  It would bypass the instance rate limit and the pinned binding. Platform
  proxies bound tools instead.

## Consequences

- Extensions become testable in isolation through fakes for the ports, which is
  what ADR-0005 requires.
- A server endpoint that authenticates Nostr callers becomes available. Other
  features may reuse the NIP-98 verifier, but each reuse is its own decision.
- The operator bears inference cost. Rate limits are the only spend control in
  this ADR; budget caps are an open question.
- Sending seller-written text to a third-party model provider is a data-flow
  change. The product form must say so next to the button, and the operator
  must opt in.
- The manifest shape grows (`hostPorts`, `egress`, `actions`). Existing manifest
  tests need updating.
- Extension actions become callable by Nostr-native agents and other clients
  over ContextVM. Exposing them on public relays widens who can spend operator
  money, which is why exposure is opt-in per action and per instance.
- Operators get an admin store, but installs from it depend on a server-side
  settings store that does not exist yet. Until then the store is read-only.
- Third-party ContextVM servers can provide capabilities without running code on
  the instance. The operator bears the trust decision, which is recorded as a
  pinned binding.
- This ADR is proposed design. Steps 1–4 exist:
  - SDK contracts in `sdk/core/extensions/` (port interfaces, manifest and
    action validation, `executeExtensionAction`, descriptors and capability
    lookup, the HTTP and ContextVM clients, and test fakes);
  - Platform host ports, NIP-98 verifier, rate limiter, environment config,
    registry wiring, the action route, and `/api/config` descriptors in
    `platform/extensions/` and `platform/server/extensions.ts`.

  The first built-in, `product-image-describer`
  (`sdk/extensions/product-image-describer/`), is a deterministic mock-up: it
  drafts a description from the image URL filename and the seller's fields,
  with no host ports, no egress, and no image analysis, and labels its output
  `mock: true`. It is off unless `EXTENSION_PRODUCT_IMAGE_DESCRIBER_ENABLED` is
  set. The admin page `/dashboard/app-settings/extensions` lists enabled
  extensions with their logos and lets an admin try the action. With no
  extension enabled, instance behaviour is unchanged. The
  storage port is in-memory, and rate limits reset on restart. The product
  form slot, ContextVM tool registration, the store, and the reference
  extension do not exist yet.

## Implementation Sequence

Each step is an independently reviewable PR.

1. SDK: port interfaces, manifest fields, validation, and action types, with
   unit tests. No runtime change.
2. Platform: scoped relay/http/storage/log port implementations and unit tests,
   including egress denial and redaction.
3. Platform: NIP-98 verifier with tests for replay, skew, wrong `u`/method, and
   payload-hash mismatch.
4. Platform: registry wiring in startup, the action route, and descriptors in
   `/api/config`. Ship it behind no enabled extensions, so behavior is unchanged.
5. SDK client `invokeExtensionAction`; UI capability-gated slot in the product
   form.
6. `ai-product-description` extension with unit tests, the local fake provider,
   the e2e gate spec with video, and `.env.example` entries.
7. Platform: register opted-in extension actions as ContextVM tools
   (`injectClientPubkey: true`, `ext.` tool names, shared rate-limit budget)
   and an operator switch for ContextVM exposure.
8. SDK: manifest `description` (short ≤120 / long ≤2000), `license`, and
   `repository` fields; store entry types; parsers for kind 11316/11317
   announcements; the install-state vocabulary (including `needs_setup`); and
   the binding pin (tool name plus `inputSchema` hash), with unit tests.
9. Platform + UI: read-only admin store (built-in entries, registries,
   sideloads, `env_managed` state) behind NIP-98 admin auth, with per-port call
   counters on the admin view.
10. Platform: server-side settings store (separate decision), then store
    installs for built-in extensions with consent, write-only secrets, and
    registry reconfiguration.
11. Platform: remote bindings — the ContextVM client proxy, pin verification,
    health checks, and capability mapping.
12. Docs: operator guide for enabling extensions, the store, and the data-flow
    disclosure.

## Open Questions

- Should rate limits be stored in memory (lost on restart) or persisted? Should
  operators get a daily sat budget per extension, based on the Routstr balance
  endpoint?
- Should the `http` port allow the operator to point an extension at any origin,
  or only at origins pre-declared in the manifest? This ADR intersects both.
- Where do extension settings live once there is an admin UI? Private values
  must not go to relays, so this needs a server-side secret store decision.
- Should a client-runtime, user-funded mode (seller's own Cashu token) share the
  same action contract, and how does it interact with the Cashu wallet's
  monetary authority (ADR-0010)?
- Which process hosts ContextVM extension tools: the existing
  `contextvm/server.ts` process or the main server. If they differ, the shared
  per-pubkey rate-limit budget needs shared storage.
- Should ContextVM extension tools be announced to public bootstrap relays in
  production, or kept on the operational relays only?
- Settings store design: where it lives, how private values are encrypted and
  keyed, and how it is backed up and migrated.
- Which key curates the Plebeian Market default registry
  (`DEFAULT_REGISTRY_CURATORS` in `platform/extensions/repository.ts` is empty
  until it is chosen)?
- Should user activation (§7.6) persist across devices, for example as
  application-specific data, or stay local to the client?
- Should built-in extensions get an optional lifecycle `health()` hook, so the
  store can report Start9-style health for them too?
- Health-check cadence for remote bindings, and whether an `unreachable`
  binding hides its capability from `/api/config`.
- Can a remote binding be invoked over the instance's own ContextVM transport
  (re-exposure), or only over HTTP?
