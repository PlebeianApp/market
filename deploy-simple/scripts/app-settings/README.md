# App Settings Scripts

Stage-aware operational scripts for inspecting and republishing the app setup
events directly on a relay.

## Files

- `inspect.ts` - Queries the current `31990` app settings event and the `30000`
  `admins` / `editors` lists for a stage
- `publish.ts` - Signs and publishes one or more of those events directly to the
  stage relay using a provided private key
- `examples/*.json` - Example payload files for the publish script

## Inspect

```bash
bun run deploy-simple/scripts/app-settings/inspect.ts --stage staging
bun run deploy-simple/scripts/app-settings/inspect.ts --stage production
```

Optional overrides:

```bash
bun run deploy-simple/scripts/app-settings/inspect.ts \
  --stage staging \
  --relay-url wss://relay.staging.plebeian.market \
  --api-url https://staging.plebeian.market/api/config
```

## Publish

The publish script signs directly with the provided private key, so use the app
private key for the target stage.

```bash
bun run deploy-simple/scripts/app-settings/publish.ts \
  --stage staging \
  --secret-key "$APP_PRIVATE_KEY" \
  --settings-file deploy-simple/scripts/app-settings/examples/settings.example.json \
  --admins-file deploy-simple/scripts/app-settings/examples/admins.example.json \
  --editors-file deploy-simple/scripts/app-settings/examples/editors.example.json
```

You can publish only a subset:

```bash
bun run deploy-simple/scripts/app-settings/publish.ts \
  --stage production \
  --secret-key "$APP_PRIVATE_KEY" \
  --settings-file /path/to/settings.json
```

Dry-run the generated events first:

```bash
bun run deploy-simple/scripts/app-settings/publish.ts \
  --stage staging \
  --secret-key "$APP_PRIVATE_KEY" \
  --settings-file /path/to/settings.json \
  --dry-run
```

## JSON Shapes

`settings.example.json`:

```json
{
	"name": "staging",
	"displayName": "Plebeian Market Staging",
	"picture": "https://staging.plebeian.market/images/logo.svg",
	"banner": "https://staging.plebeian.market/banner.svg",
	"ownerPk": "1111111111111111111111111111111111111111111111111111111111111111",
	"contactEmail": "ops@example.com",
	"allowRegister": true,
	"defaultCurrency": "USD",
	"blossom_server": "https://blossom.staging.plebeian.market",
	"nip96_server": "https://nip96.staging.plebeian.market",
	"showNostrLink": false
}
```

`admins.example.json`:

```json
{
	"admins": ["1111111111111111111111111111111111111111111111111111111111111111"]
}
```

`editors.example.json`:

```json
{
	"editors": ["3333333333333333333333333333333333333333333333333333333333333333"]
}
```
