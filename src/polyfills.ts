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

console.log('Buffer polyfill loaded:', typeof Buffer !== 'undefined')
