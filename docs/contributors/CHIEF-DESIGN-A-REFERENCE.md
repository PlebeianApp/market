# Chiefmonkey Design A reference

This branch uses the supplied Perplexity artifact at
<https://www.perplexity.ai/computer/a/8fb75ecc-f5b7-4da7-988f-4f2183fc60fd>
as its visual reference. The reference was inspected on 2026-11-12 with the
artifact's selected tab explicitly showing **A Catalogue** and the preview URL
fragment `#a`.

Visible distinguishing features used here are:

- a warm cream canvas (`#f4ece3`) with a sticky translucent header;
- an editorial serif Plebeian Auctions wordmark with pink Auctions accent;
- compact pill navigation with the Catalogue tab selected;
- a breadcrumb-led lot page instead of an oversized marketing hero;
- a wide item stage beside a narrower auction action panel;
- a raised off-white bid card with the committed price and countdown as the
  strongest numeric hierarchy;
- a magenta primary bid action, restrained rounded borders, and monospaced
  price/countdown values;
- a one-column mobile flow in which the item stage precedes the auction action
  panel.

The artifact also displays livestream, chat, watchlist, reputation, max-bid,
shipping and reminder interactions. Those are mockup-only and remain visibly
gated in this MVP. No artifact images, video, logo, font files, or other remote
assets are copied into this branch. Existing project-owned CSS shapes and
seller-supplied HTTPS item images remain the only presentation assets.

This is a presentation adaptation only. It does not change bid, payment,
return, payout, settlement, signer, validator, timing, or policy semantics. The
Clave relay/CSP fix inherited from `5281bcec0ce8bfb87d3a06177118b51435033ff2`
is preserved unchanged.
