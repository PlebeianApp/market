/**
 * `@plebeian/product` — the product module (feature spec: `browsing-explore-search.md`).
 *
 * One module, two responsibilities that the prototype had split into two packages:
 *   · `event`   — decides whether an untrusted relay event is a usable listing, and turns it into a
 *                 typed view (schemas · validation · protocol);
 *   · `queries` — describes **what to ask for**, as data, and stops.
 *
 * They were separate packages because they felt like different layers. They are one module because
 * nothing consumes one without the other: every reader of a listing also asks for it, and every surface
 * that renders one had to depend on both. Splitting on a technical seam rather than a consumer boundary
 * is what the maintainer called too granular (2026-09-22), and the alignment review records it as
 * drift D-2.
 *
 * The dependency arrow points one way: this module depends on `@plebeian/contract`, never the reverse.
 */
export * from './event'
export * from './queries'
