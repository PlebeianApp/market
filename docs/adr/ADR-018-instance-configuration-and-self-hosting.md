# ADR-018: Instance Configuration and Self-Hosting Boundary

## Status

Proposed

## Date

2026-09-07

## Related

- ADR-0001: hierarchical AGENTS.md and ADR docs
- ADR-002: Nostr I/O migration (NDK → Applesauce), which also touches relay
  targeting and is expected to move relay selection behind `src/lib/nostr/io.ts`
- Runtime config surface: `src/server/http/config.ts`, `src/queries/config.tsx`
- App settings event: kind `31990`, `d=plebeian-market-handler`

## Context

The application is currently written as if exactly one deployment exists, and
that deployment is `plebeian.market`. Instance-specific values are compiled into
module-level literals rather than resolved from configuration.

Three distinct kinds of identity are conflated in those literals:

- Software identity. Values that name the code itself, and that must be
  identical across every deployment for events to remain interoperable. The
  NIP-89 `client` software name in `src/publish/nip89.ts` and the HD derivation
  context `AUCTION_HD_ROOT_CONTEXT` in `src/lib/auctionHd.ts` are in this class.
- Instance identity. Values that name a particular marketplace: app relay URL,
  app pubkey, owner pubkey, handler `d` tag, site URL, logo, banner, terms text,
  social links, support contact.
- Network defaults. Third-party infrastructure the app happens to prefer:
  public relay lists, Cashu mints, Blossom and NIP-96 hosts, price and mempool
  APIs.

Only the first class should be frozen. The second and third are currently frozen
anyway, mostly in `src/lib/constants.ts`, `src/publish/nip89.ts`,
`src/lib/appSettings.ts`, `src/lib/blossom.ts`, and the branding surface
(`src/index.html`, `public/manifest.json`, footer, dialogs).

This produces four concrete problems.

- A self-hoster must fork and edit source across roughly twenty files, then
  rebuild. Every upstream merge re-conflicts on those same lines.
- Configuration already has two partially overlapping channels that can
  disagree. `/api/config` returns an authoritative `appRelay` derived from
  `APP_RELAY_URL`, while `src/lib/relay-policy.ts` resolves the main relay from
  the build-time `MAIN_RELAY_BY_STAGE` map. A deployment can therefore have a
  server talking to its own relay and a client talking to
  `wss://relay.plebeian.market`.
- Build-time inlining is already known to be unreliable for distinguishing
  deployments. `src/lib/constants.ts` documents that the Bun build inlines
  `process.env.NODE_ENV='production'` for staging and production alike, which is
  why `getCurrencyServerRelays` takes stage as a runtime argument.
- Instance-scoped `d` tags are shared. `plebeian-market-handler` and
  `plebeian-market-cart` address real user data on the production relay. Two
  instances sharing a relay collide; changing the tags without a compatibility
  path orphans existing carts and handler events.

A configuration mechanism already exists and should be extended rather than
replaced: the kind `31990` app settings event, validated by `AppSettingsSchema`
in `src/lib/schemas/app.ts`, fetched server-side by `fetchAppSettings`, held in
`src/server/runtime.ts`, and delivered to the client through `/api/config`. It
already carries `name`, `displayName`, `picture`, `banner`, `ownerPk`,
`allowRegister`, `defaultCurrency`, `contactEmail`, `blossom_server`, and
`nip96_server`. `src/server/runtime.ts` also already demonstrates the intended
resolution style in `resolveCvmServerPubkey`: an explicit fallback ladder that
terminates in a thrown error rather than a hardcoded default.

That event cannot be the sole mechanism. Fetching it requires a relay URL and an
app pubkey, so a tier below it must exist. The `needsSetup` flag returned by
`/api/config` exists precisely because the event may be absent.

## Decision

Adopt a layered instance configuration resolver with an explicit precedence
chain, a single typed shape, and a documented frozen/configurable boundary.

### Precedence

For every instance-scoped or network-default value, resolution proceeds:

1. Kind `31990` app settings event. Runtime, editable by the instance owner
   without redeployment.
2. Server environment. Bootstrap values and anything required before the
   settings event can be fetched.
3. Shipped neutral defaults. Last resort only.

Higher tiers win. No value is resolved at build time.

### Frozen values

The following are software identity and are explicitly not configurable.
Changing them is a data-breaking change, not a configuration change.

- `AUCTION_HD_ROOT_CONTEXT` in `src/lib/auctionHd.ts`. It is an input to key
  derivation; altering it changes derived auction keys.
- Nostr kind numbers and NIP-89 handler semantics.
- The NIP-89 `client` tag software name. Its relay hint and handler coordinate
  are instance-scoped and do become configurable.

Each frozen value carries an inline comment stating why it is frozen.

### Single resolver

A new `src/lib/instance-config.ts` owns the typed shape and the resolution
chain. `AppSettingsSchema` is extended with optional instance fields
(`handlerId`, `siteUrl`, `publicRelays`, `trustedMints`, `bugRelay`, `termsUrl`
or terms content, `socialLinks`, `supportContact`) rather than a parallel schema
being introduced. `/api/config` carries the resolved config; the client reads it
through `src/queries/config.tsx` and the config store.

`src/lib/constants.ts` retains its literals only as tier 3 defaults. The
Plebeian-specific values move into `deploy-simple/env/*`, where they are that
instance's configuration rather than the software's defaults.

### Relay resolution

The runtime `appRelay` from `/api/config` is authoritative. `MAIN_RELAY_BY_STAGE`
is demoted to a development fallback used only when runtime config is
unavailable.

### Namespaced `d` tags with a compatibility window

Instance-scoped `d` tags become `${instanceNamespace}-handler` and
`${instanceNamespace}-cart`, with the namespace defaulting to the current
literals so the Plebeian instance produces byte-identical events. Reads accept
both the namespaced and legacy tags for at least one release.

### Guardrails

- A footprint check, modelled on `scripts/check-ndk-footprint.sh`, fails when a
  new instance-specific literal appears under `src/` outside an allowlist.
- A non-Plebeian instance (distinct namespace, relay, and app pubkey) must
  complete a browse, cart, and checkout path in the e2e suite. The decision is
  not considered implemented until that run is green.

## Alternatives Considered

- Build-time environment injection. Rejected. It requires a rebuild per
  instance, duplicates the existing runtime channel, and repeats the documented
  `NODE_ENV` inlining hazard that already forced `getCurrencyServerRelays` to
  take stage at runtime.
- Kind `31990` event as the sole source. Rejected as sole mechanism due to the
  bootstrap dependency on relay URL and app pubkey. It remains the highest
  precedence tier.
- Extracting a separate branding or theme package. Rejected as a first step.
  Large blast radius, no user-visible benefit over the layered resolver, and
  premature before real self-hosters reveal which values they actually change.

## Consequences

- Self-hosting becomes a configuration task rather than a fork. The same build
  artifact serves multiple instances.
- The client and server can no longer disagree about the app relay.
- Configuration gains one precedence chain that contributors must learn, and a
  transitional period in which some call sites read the resolver while others
  still read `src/lib/constants.ts`. The footprint check exists to bound that
  window.
- The `d` tag compatibility window adds dual-read logic to cart persistence,
  relay preferences, and handler lookup. That logic is removable after one
  release.
- Extending `AppSettingsSchema` with optional fields keeps existing published
  settings events valid; no relay-side migration is required.
- Terms and conditions move out of `src/components/dialogs/TermsConditionsDialog.tsx`
  and become instance-supplied. Jurisdiction-specific legal text stops being a
  code constant.

## Implementation Notes

Sequenced as four reviewable changes rather than one:

1. Config foundation. `src/lib/instance-config.ts`, schema extension,
   `src/server/runtime.ts`, `src/server/http/config.ts`, `src/queries/config.tsx`,
   config store, `.env` examples. No behavior change; the Plebeian instance must
   produce byte-identical events.
2. Relay, identity, and namespace de-hardcoding. `src/lib/constants.ts`,
   `src/lib/relay-policy.ts`, `src/lib/appSettings.ts`, `src/publish/nip89.ts`,
   `src/lib/schemas/cartPersistence.ts`, `src/publish/relay-preferences.tsx`,
   `src/lib/blossom.ts`, `src/lib/stores/nip60.ts`, `src/queries/products.tsx`,
   `src/queries/external.tsx`, `src/lib/utils/mempool.ts`, `src/routes/setup.tsx`,
   and the app settings dashboard route. Highest risk; carries the compatibility
   window.
3. Branding and legal surface. `src/index.html`, `public/manifest.json`, terms
   dialog, footer, share dialogs, NIP-46 connect QR, zap dialog, welcome screen,
   and the about route. Links to the upstream project remain hardcoded, since
   those are software identity.
4. Operations, documentation, and guardrails. `scripts/startup.ts`,
   `scripts/settings.json`, `scripts/seed.ts`, `deploy-simple/` env and
   app-settings scripts, `e2e/test-config.ts`, `e2e/seed-relay.ts`,
   `docs/self-hosting.md`, and the footprint check script.

## Open Questions

- Terms and conditions delivery: an instance-supplied URL is simplest but adds
  an off-instance dependency; markdown carried in the settings event is
  self-contained but enlarges a replaceable event.
- Whether `d` tag namespacing is worth its compatibility cost, versus keeping
  the current literals frozen as a software-level namespace and accepting that
  two instances sharing one relay collide on cart state.
