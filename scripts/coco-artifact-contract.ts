import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export const COCO_ROUND_14_SHA = '34f968f7032b8b2120ccd8eccdf60542a61a1aad' as const
export const COCO_VENDOR_DIRECTORY = `vendor/coco-${COCO_ROUND_14_SHA}` as const
export const COCO_CORE_ARCHIVE_SHA256 = '1cbb354810f47072190a1da725c6ba4da92e724da703c8a86eab31e57922d2b9' as const
export const COCO_INDEXEDDB_ARCHIVE_SHA256 = '79239d876820f3f3f5eaccaa0765e0f7a84ac8be5ca78baa9fcfa0a11e2a6953' as const
export const COCO_CORE_INSTALLED_CONTENT_HASH = 'sha256:70602fc9ce09751502977e64434ca3e2a475d700a46d0f2a4e95ed50f157f796' as const
export const COCO_INDEXEDDB_INSTALLED_CONTENT_HASH = 'sha256:7507ff64326da39f1758fde233b318e454984142bb5e7e6ae5cac72a85e790fd' as const

export async function installedContentHash(root: string): Promise<string> {
	const files: string[] = []
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory)) {
			const absolute = path.join(directory, entry)
			const metadata = await lstat(absolute)
			if (metadata.isSymbolicLink()) throw new Error(`Installed Coco package contains a forbidden symlink: ${absolute}`)
			if (metadata.isDirectory()) await visit(absolute)
			else if (metadata.isFile()) files.push(absolute)
			else throw new Error(`Installed Coco package contains an unsupported filesystem entry: ${absolute}`)
		}
	}
	await visit(root)
	const aggregate = createHash('sha256')
	for (const absolute of files.sort()) {
		const relative = path.relative(root, absolute).split(path.sep).join('/')
		const fileHash = createHash('sha256')
			.update(await readFile(absolute))
			.digest('hex')
		aggregate.update(relative).update('\0').update(fileHash).update('\n')
	}
	return `sha256:${aggregate.digest('hex')}`
}
