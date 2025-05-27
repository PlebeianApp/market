// Polyfills for browser environment to support Node.js libraries
import { Buffer } from 'buffer'

// Set Buffer as a global
if (typeof globalThis !== 'undefined') {
	;(globalThis as any).Buffer = Buffer
}
if (typeof window !== 'undefined') {
	;(window as any).Buffer = Buffer
}
if (typeof global !== 'undefined') {
	;(global as any).Buffer = Buffer
}

// Add the specific numberIsNaN function that bitcoinjs-lib expects
// This is the exact function that Node.js provides
const numberIsNaN = (value: any): boolean => {
	return typeof value === 'number' && isNaN(value)
}

// Add other Node.js util functions that might be needed
const nodeUtilFunctions = {
	numberIsNaN,
	isNumber: (value: any): boolean => typeof value === 'number',
	isString: (value: any): boolean => typeof value === 'string',
	isBoolean: (value: any): boolean => typeof value === 'boolean',
	isNull: (value: any): boolean => value === null,
	isUndefined: (value: any): boolean => value === undefined,
	isObject: (value: any): boolean => value !== null && typeof value === 'object',
	isFunction: (value: any): boolean => typeof value === 'function'
}

// Set all Node.js globals
if (typeof globalThis !== 'undefined') {
	// Add individual functions as globals (this is what Node.js does)
	Object.assign(globalThis, nodeUtilFunctions)
	
	// process polyfill
	if (typeof (globalThis as any).process === 'undefined') {
		;(globalThis as any).process = {
			env: { NODE_ENV: 'production' },
			version: '',
			versions: { node: '18.0.0' },
			platform: 'browser',
			browser: true
		}
	}
}

if (typeof window !== 'undefined') {
	// Add individual functions as globals to window
	Object.assign(window, nodeUtilFunctions)
	
	// process polyfill for window
	if (typeof (window as any).process === 'undefined') {
		;(window as any).process = {
			env: { NODE_ENV: 'production' },
			version: '',
			versions: { node: '18.0.0' },
			platform: 'browser',
			browser: true
		}
	}
	
	// global polyfill for window
	if (typeof (window as any).global === 'undefined') {
		;(window as any).global = window
	}
}

console.log('Polyfills loaded:')
console.log('- Buffer:', typeof Buffer !== 'undefined')
console.log('- numberIsNaN:', typeof (globalThis as any)?.numberIsNaN !== 'undefined')
console.log('- process:', typeof (globalThis as any)?.process !== 'undefined')
