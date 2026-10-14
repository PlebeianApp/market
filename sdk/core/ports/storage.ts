/** Asynchronous key/value persistence port; hosts own encryption and storage policy. */
export interface KeyValueStoragePort {
	get(key: string): Promise<string | null>
	set(key: string, value: string): Promise<void>
	remove(key: string): Promise<void>
}
