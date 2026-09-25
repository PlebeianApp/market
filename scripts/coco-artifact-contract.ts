import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export const COCO_CORE_SHA = '60b7b070393eaad8746cb74a03c42017186da647' as const
export const COCO_VENDOR_DIRECTORY = `vendor/coco-${COCO_CORE_SHA}` as const
export const COCO_CORE_ARCHIVE_SHA256 = 'c41c4b95f90e360cee66b06e6abe354419567f38c798abfcf6202a610200b090' as const
export const COCO_INDEXEDDB_ARCHIVE_SHA256 = 'b3c70d4d9d655e055f216afcf7882cfd1825bc1a7754fd801616f27ced9daabf' as const
export const COCO_CORE_INSTALLED_CONTENT_HASH = 'sha256:0819c057889e55f8093dc9803b5646be628cfca6bb054f69d2037620d5dcc105' as const
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
