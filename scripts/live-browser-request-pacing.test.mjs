import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { liveBrowserRequestPacingPrelude } from "./live-browser-request-pacing.mjs";

test("serializes same-origin fetch starts without delaying another origin", async () => {
  const starts = [];
  const context = {
    Date,
    Promise,
    Request,
    URL,
    clearInterval,
    fetch: async (input) => {
      starts.push({ input: input instanceof Request ? input.url : String(input), at: Date.now() });
      return { ok: true };
    },
    location: { href: "https://demo.invalid/", origin: "https://demo.invalid" },
    setInterval,
    setTimeout,
  };
  vm.runInNewContext(liveBrowserRequestPacingPrelude(80), context);

  await Promise.all([context.fetch("/one"), context.fetch("/two"), context.fetch("/three")]);
  assert.equal(starts.length, 3);
  assert.ok(starts[1].at - starts[0].at >= 65, "second request was not paced");
  assert.ok(starts[2].at - starts[1].at >= 65, "third request was not paced");

  const before = Date.now();
  await context.fetch("https://elsewhere.invalid/unrelated");
  assert.ok(starts[3].at - before < 40, "cross-origin request was unexpectedly queued");
});

test("rejects an invalid pacing interval", () => {
  assert.throws(() => liveBrowserRequestPacingPrelude(0), /positive safe integer/);
});
