import { file } from 'bun'
import { join } from 'path'
import type { BunRoutes } from './types'

/** Serve a single file from `public/<path>`. */
export const serveStatic = async (path: string): Promise<Response> => {
	const filePath = join(process.cwd(), 'public', path)
	try {
		const f = file(filePath)
		if (!f.exists()) {
			return new Response('File not found', { status: 404 })
		}
		// Determine content type based on file extension.
		const contentType = path.endsWith('.svg')
			? 'image/svg+xml'
			: path.endsWith('.png')
				? 'image/png'
				: path.endsWith('.jpg') || path.endsWith('.jpeg')
					? 'image/jpeg'
					: path.endsWith('.css')
						? 'text/css'
						: path.endsWith('.js')
							? 'application/javascript'
							: path.endsWith('.json')
								? 'application/json'
								: path.endsWith('.ico')
									? 'image/x-icon'
									: 'application/octet-stream'

		return new Response(f, {
			headers: { 'Content-Type': contentType },
		})
	} catch (error) {
		console.error(`Error serving static file ${path}:`, error)
		return new Response('Internal server error', { status: 500 })
	}
}

// Bun's path-parameterised handler receives a `BunRequest<Path>` whose
// `params` is typed `Record<string, string>` after we erase the literal
// path generics through our merged BunRoutes record. We read `params.file`
// at runtime — Bun's router supplies it for `/images/:file`.
export const staticRoutes: BunRoutes = {
	'/images/:file': (req) => serveStatic(`images/${req.params?.file ?? ''}`),
	'/manifest.json': () => serveStatic('manifest.json'),
	'/sw.js': () => serveStatic('sw.js'),
	'/favicon.ico': () => serveStatic('favicon.ico'),
}
