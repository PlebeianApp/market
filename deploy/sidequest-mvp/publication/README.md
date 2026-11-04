# Sanitized separated-MVP configuration examples

These files document the current configuration shape without publishing the
live deployment topology. They are intentionally non-deployable: all host
identities, digests, node IDs and approval bindings must be replaced through
the reviewed renderer and deployment process.

The IPv4 addresses use IANA documentation space, origins use the reserved
`.invalid` domain, and the FIPS addresses are local examples. No password,
private key, FROST share, wallet material, token, authentication database or
exact live-network value is included.

The canonical rendering and validation implementation remains:

- `deploy/sidequest-mvp/render-runtime-config.py`
- `deploy/sidequest-mvp/runtime-bindings.template.json`
- `deploy/sidequest-mvp/verify-successor-runtime.py`

Do not copy an example directly to `/etc`. Produce a new configuration from
reviewed inputs, validate it, and use separately authorized installation and
activation actions.
