import { EXTENSION_HOST_PORTS, parseExtensionConfig, type AnyExtensionDefinition, type ExtensionHostPortName } from '@sdk/core/extensions'
import type { ExtensionInstanceSetting } from './registry'

/** Keys under an extension's prefix that configure Platform policy rather than extension config. */
const RESERVED_KEYS = new Set(['ENABLED', 'EGRESS', 'HOST_PORTS'])
const PUBLIC_PREFIX = 'PUBLIC_'

export interface ExtensionEnvPolicy {
	/** Operator egress allowlist (`EXTENSION_<ID>_EGRESS`, comma-separated origins); intersected with the manifest. */
	egress?: string[]
	/** Operator port grants (`EXTENSION_<ID>_HOST_PORTS`, comma-separated); defaults to everything requested. */
	hostPorts?: ExtensionHostPortName[]
}

export interface ExtensionEnvConfig {
	/** Settings that parsed; safe to pass to `ExtensionRegistry.configure`. */
	settings: ExtensionInstanceSetting[]
	policies: Map<string, ExtensionEnvPolicy>
	/** Per-extension problems. The extension stays disabled; messages never contain private values. */
	errors: { id: string; message: string }[]
}

/** `ai-product-description` → `EXTENSION_AI_PRODUCT_DESCRIPTION_`. */
export function extensionEnvPrefix(extensionId: string): string {
	return `EXTENSION_${extensionId.toUpperCase().replace(/[.-]/g, '_')}_`
}

/**
 * Reads extension settings from the server environment (ADR-018: secrets come only from the environment).
 *
 * - `EXTENSION_<ID>_ENABLED=true` enables the extension.
 * - `EXTENSION_<ID>_PUBLIC_<FIELD>` goes to `publicConfig.<field>` (camelCased).
 * - Any other `EXTENSION_<ID>_<FIELD>` goes to `privateConfig.<field>`. Private is the default so a
 *   misnamed secret can never reach `/api/config`.
 *
 * Values are strings; config schemas coerce them (e.g. `z.coerce.number()`).
 */
export function readExtensionEnvConfig(
	definitions: readonly AnyExtensionDefinition[],
	env: Readonly<Record<string, string | undefined>>,
): ExtensionEnvConfig {
	const errors: ExtensionEnvConfig['errors'] = []
	const prefixes = new Map<string, string>()
	for (const definition of definitions) {
		const id = definition.manifest.id
		const prefix = extensionEnvPrefix(id)
		const clash = [...prefixes].find(([, other]) => other === prefix)
		if (clash) {
			errors.push({ id, message: `Environment prefix ${prefix} is shared with ${clash[0]}` })
			continue
		}
		prefixes.set(id, prefix)
	}

	// Longest prefix wins, so `EXTENSION_AI_PRODUCT_X` is not read as field `PRODUCT_X` of extension `ai`.
	const ordered = [...prefixes].sort((a, b) => b[1].length - a[1].length)
	const raw = new Map<string, Map<string, string>>()
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined || !key.startsWith('EXTENSION_')) continue
		const match = ordered.find(([, prefix]) => key.startsWith(prefix) && key.length > prefix.length)
		if (!match) continue
		const fields = raw.get(match[0]) ?? new Map<string, string>()
		fields.set(key.slice(match[1].length), value)
		raw.set(match[0], fields)
	}

	const settings: ExtensionInstanceSetting[] = []
	const policies = new Map<string, ExtensionEnvPolicy>()
	for (const definition of definitions) {
		const id = definition.manifest.id
		if (!prefixes.has(id)) continue
		const fields = raw.get(id)
		if (!fields || !isTruthy(fields.get('ENABLED'))) continue

		const publicConfig: Record<string, string> = {}
		const privateConfig: Record<string, string> = {}
		for (const [field, value] of fields) {
			if (RESERVED_KEYS.has(field)) continue
			if (field.startsWith(PUBLIC_PREFIX)) publicConfig[camelCase(field.slice(PUBLIC_PREFIX.length))] = value
			else privateConfig[camelCase(field)] = value
		}

		const policy = parsePolicy(fields)
		if (!policy.ok) {
			errors.push({ id, message: policy.message })
			continue
		}

		const setting: ExtensionInstanceSetting = {
			id,
			enabled: true,
			publicConfig,
			...(Object.keys(privateConfig).length > 0 || definition.manifest.privateConfig ? { privateConfig } : {}),
		}
		const parsed = parseExtensionConfig(definition.manifest, setting)
		if (!parsed.ok) {
			errors.push({ id, message: parsed.error.message })
			continue
		}
		settings.push(setting)
		policies.set(id, policy.value)
	}
	return { settings, policies, errors }
}

function parsePolicy(fields: Map<string, string>): { ok: true; value: ExtensionEnvPolicy } | { ok: false; message: string } {
	const policy: ExtensionEnvPolicy = {}
	const egress = fields.get('EGRESS')
	if (egress !== undefined) policy.egress = splitList(egress)
	const hostPorts = fields.get('HOST_PORTS')
	if (hostPorts !== undefined) {
		const ports = splitList(hostPorts)
		const unknown = ports.find((port) => !(EXTENSION_HOST_PORTS as readonly string[]).includes(port))
		if (unknown) return { ok: false, message: `Unknown host port in HOST_PORTS: ${unknown}` }
		policy.hostPorts = ports as ExtensionHostPortName[]
	}
	return { ok: true, value: policy }
}

function splitList(value: string): string[] {
	return value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
}

function isTruthy(value: string | undefined): boolean {
	return value !== undefined && ['true', '1', 'yes'].includes(value.trim().toLowerCase())
}

function camelCase(field: string): string {
	return field.toLowerCase().replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}
