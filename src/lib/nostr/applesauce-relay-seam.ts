/**
 * First-party seam over the `applesauce-relay` library.
 *
 * `applesauce-relay` is a third-party shared module. Under bun's frozen
 * module namespaces, `mock.module('applesauce-relay')` globally intercepts
 * every import of that module for the whole test invocation (verified
 * empirically in relay-applesauce-semantics.test.ts), leaking the mock into
 * unrelated files (e.g. nostr-connect-signer). Test files must mock this
 * first-party seam instead, so the shared library namespace stays real.
 */
export { RelayGroup, RelayPool } from 'applesauce-relay'
