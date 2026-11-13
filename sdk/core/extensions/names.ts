import { isValidExtensionActionName } from './actions'

const CAPABILITY = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/
export const MAX_CAPABILITY_LENGTH = 100

/** Shared by the bind form and the server so both explain the same rule. */
export const CAPABILITY_FORMAT_HINT =
	'Use lowercase letters and digits joined by dots, e.g. product.image.describe (no spaces, capitals, or underscores)'

/** Returns why a capability name is invalid, or `undefined` if it is valid. */
export function capabilityProblem(value: string): string | undefined {
	if (!value) return 'Enter a capability'
	if (value.length > MAX_CAPABILITY_LENGTH) return `Capability must be at most ${MAX_CAPABILITY_LENGTH} characters`
	return CAPABILITY.test(value) ? undefined : CAPABILITY_FORMAT_HINT
}

/** Returns why an action name is invalid, or `undefined` if it is valid. */
export function actionNameProblem(value: string): string | undefined {
	return isValidExtensionActionName(value) ? undefined : 'Action name must be lowercase words joined by dashes, e.g. get-quote'
}

/** Lowercase alphanumeric words of a tool name, e.g. `describeProductImage` or `describe_product_image` → describe, product, image. */
export function toolNameWords(toolName: string): string[] {
	return toolName
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
}
