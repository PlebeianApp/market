# Launch preparation checkpoint

The validators have the exact accepted genesis bundle, four acknowledgements,
and launch seal, but they are intentionally stopped. A fresh read-only check
found that all five installed `friday.env` files still contain placeholders,
the browser and health pin files are absent, and the successor side-quest
release is absent on all five hosts. V1-V4 network roots and local validator
leaves remain root-owned `0700`, so the `plebeian-friday` service account cannot
traverse or update them. Starting a validator in this state would fail closed.

APP has no network root, no staged bundle and no observer receipt. This is the
expected fresh precondition for the production `init-observer` path. FIPS and
the fake-sat mint were already active when observed; no service was changed by
this reconciliation. The three bounded public mint GETs match the accepted
payment projection. They were used to render candidate browser and health pins
beside this checkpoint.

## Smallest next mutation

Stage the accepted nine public bundle files create-once on APP at:

`/var/lib/plebeian-auctions-friday/separated-inputs/comet-genesis-bundle-830b87e49bf4ef0ee66664b9b757344a8c9ae8a582473fe28351e8571a7180cf`

Then invoke the already installed, pinned predecessor binary exactly once:

```text
/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/plebeian-auctions-poc init-observer \
  --home /var/lib/plebeian-auctions-friday/network-separated \
  --bundle /var/lib/plebeian-auctions-friday/separated-inputs/comet-genesis-bundle-830b87e49bf4ef0ee66664b9b757344a8c9ae8a582473fe28351e8571a7180cf \
  --expected-bundle-digest 830b87e49bf4ef0ee66664b9b757344a8c9ae8a582473fe28351e8571a7180cf \
  --owner-approval-public-key 3210f99b78ecd0150b6a0efcaffc6f3b532f4e5a3d68f977e77a3b8d10febade \
  --fips-p2p-listen tcp://[fdb2:77a9:c591:3ac6:3513:5bf8:cc3b:5a04]:27656
```

This creates the APP network root and one persistent non-voting Comet P2P
transport private key. It creates no validator/FROST key and performs no
payment. Capture only the public `observer.json`, its SHA-256 and node ID. Stop
and preserve state on any failure; do not delete or retry a partial root.

Suggested exact approval wording:

> May I stage the accepted nine-file public genesis bundle on APP and run the
> installed `init-observer` command exactly once against the currently absent
> APP network root? It will create one persistent non-voting Comet P2P transport
> key and a public observer receipt. It will not start services, touch validator
> or FROST keys, change the firewall, or perform payments.

## Actions after the observer receipt exists

1. Fill the observer receipt hash/node ID into the exact runtime configuration.
2. Install the immutable side-quest successor release and successor units on
   APP and the signer artifact/unit on V1-V4; keep every predecessor release.
3. Install root-owned `0640` browser/health pins and resolved `friday.env` files.
4. Perform an enumerated least-privilege ownership handoff: public network
   ancestors/files to `root:plebeian-friday-public` with `0750/0640`; only each
   local validator leaf and APP observer leaf to UID999/GID988 with `0700/0600`.
   Never recursively chown the shared state root or FROST tree.
5. Run all pre-start guards while services remain stopped. This is a separate
   install/configuration/ownership approval, not service activation.
6. Under a later activation approval, start V1-V4 validators, confirm height
   advances with four votes, start the APP observer and confirm catch-up, then
   start V1-V4 signers and APP coordinator/authority/site. HTTPS/nginx and the
   five-user browser rehearsal remain separate gates.

No service activation is authorized by this checkpoint.
