/**
 * `@plebeian/browse` — the browse module (feature spec: `browsing-explore-search.md`).
 *
 * One module, two responsibilities the prototype had split:
 *   · `components` — the surfaces: data in, markup out. No fetching, no validating, no store;
 *   · `filter`     — the viewer's own filter and sort state, applied purely.
 *
 * Merged for the same reason as the product module: a surface and the viewer preferences that shape it
 * are consumed together, always. See the alignment review, drift D-2.
 *
 * The token layer is a separate concern and does not live here: components consume `var(--pb-*)` and
 * contain no colour values at all (`@plebeian/contract/src/tokens.css`).
 */
export * from './components'
export * from './filter'
