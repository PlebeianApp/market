# Exact 111-sat operation: read-only Chrome console diagnostic

This diagnostic is for the already-open incognito Chrome tab whose demo actor is
`558ea655…63f37b`. It does not contact the network, sign, import, retry, discard,
or write browser storage. It prints one redacted status object.

1. Keep the original Auctions tab open. Do not reload, reconnect, or click any
   payment/recovery button.
2. Open Chrome DevTools for that exact tab and select **Console**.
3. If Chrome blocks pasting, stop. Do not type a self-XSS bypass phrase or change
   any browser security setting.
4. Copy the complete contents of
   `plebeian-friday-exact-operation-readonly-console.js`, paste it once, and run it.
5. Copy only the single object logged after
   `PLEBEIAN_READ_ONLY_DIAGNOSTIC_RESULT`. If the console instead logs
   `PLEBEIAN_READ_ONLY_DIAGNOSTIC_FAILED`, copy only its redacted `name` and
   `message` fields.

Do not expand IndexedDB rows or copy any other console or storage output.

The result fields mean:

- `operationPresent` / `operationPhase`: exact browser-private payment journal.
- `proofOperationLinkCount`: count-only lookup through Coco's
  `usedByOperationId` index; no proof row is returned. This is state-agnostic:
  it does not prove that linked proofs are still actively reserved. Computing
  the active-reservation subset would require reading secret-bearing proof rows,
  which this diagnostic deliberately refuses to do.
- `fundingAbortJournalPresent`: key-only lookup; no cancellation record is
  returned.
- `localActorMatch` / `localEnvironmentMatch`: the private record matches the
  exact local public-intent actor and environment. These fields do not query the
  current signer or authenticate the current deployed release. They are `null`
  when no private operation exists.
