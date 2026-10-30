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
  `platform/server/buildServer.ts`, `platform/server/http/config.ts`
- External: Routstr API reference — `https://docs.routstr.com/api/overview/`

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
through declared, authenticated actions** routed by Platform. Extensions return
data; users sign.

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

Manifests gain two declarative fields, validated by
`validateExtensionManifest`:

```ts
hostPorts: readonly ('relays:read' | 'relays:publish' | 'http' | 'storage')[]
egress?: readonly string[] // https origins; http only for localhost
```

### 2. Actions: the only client → server path

A server-runtime extension may declare named actions:

```ts
actions?: Record<string, {
	input: RuntimeSchema<In>
	output: RuntimeSchema<Out>
	auth: 'user' | 'admin'
	rateLimit: { perPubkey: number; windowSeconds: number }
	handler(ctx: ExtensionContext, input: In, caller: { pubkey: string }): Promise<Result<Out, SdkError>>
}>
```

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

### 4. Lifecycle wiring

- `platform/server/startup.ts` creates one `ExtensionRegistry` per instance,
  registers built-in definitions, and calls `configure()` from server
  environment settings (ADR-018). Private values come only from the
  environment, never from relay events or `/api/setup` payloads. It then calls
  `start('server')`, and `stop()` on shutdown.
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

## Alternatives Considered

- **ContextVM (MCP over Nostr) as the action transport.** This would make
  extensions callable over relays, with Nostr-native caller identity, and
  `contextvm/` already exists. Deferred, not rejected. The action contract is
  transport-neutral, and a `service`-runtime extension could later be exposed as
  a ContextVM tool. For a first extension, HTTP plus NIP-98 adds no relay
  round-trips and no new service process.
- **Session cookies or API tokens instead of NIP-98.** This adds a login
  backend. NIP-98 reuses the signer every user already has. Rejected.
- **A generic "proxy any URL" host endpoint.** This becomes an open relay for
  operator credentials. Rejected in favour of declared actions with typed I/O.
- **Client-runtime extension with a user-supplied Cashu token.** This is a valid
  second mode with user-funded inference and no operator secret. It needs a
  separate decision on client token storage under the Cashu wallet ADR-0010.
- **Third-party plugin loading (dynamic import from URL).** Out of scope.
  Extensions are first-party modules compiled into Platform until a sandboxing
  decision exists.

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
- This ADR is proposed design. None of the ports, the action route, the NIP-98
  verifier, or the reference extension exist yet.

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
7. Docs: operator guide for enabling extensions and the data-flow disclosure.

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
- When to expose actions over ContextVM in addition to HTTP.
