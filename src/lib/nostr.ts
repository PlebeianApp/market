import NDK from "@nostr-dev-kit/ndk";
import NDKCacheAdapterDexie from "@nostr-dev-kit/ndk-cache-dexie";

export class NostrService {
  private static instance: NostrService;
  private ndk: NDK;
  private _isConnecting: boolean = false;
  private _isConnected: boolean = false;

  private constructor(relays?: string[]) {
    const dexieAdapter = new NDKCacheAdapterDexie({ dbName: 'nostr-cache' });
    this.ndk = new NDK({
      cacheAdapter: dexieAdapter,
      explicitRelayUrls: relays?.length ? relays : ["wss://relay.nostr.net"],
    });
  }

  public static getInstance(relays?: string[]): NostrService {
    if (!NostrService.instance) {
      NostrService.instance = new NostrService(relays);
    }
    return NostrService.instance;
  }
  

  public async connect(): Promise<void> {
    if (this._isConnected || this._isConnecting) return;
    
    this._isConnecting = true;
    try {
      await this.ndk.connect();
      await new Promise<void>((resolve) => {
        this.ndk.pool.on("connect", () => {
          this._isConnected = true;
          resolve();
        });
      });
    } finally {
      this._isConnecting = false;
    }
  }

  public get isConnected(): boolean {
    return this._isConnected;
  }

  public get isConnecting(): boolean {
    return this._isConnecting;
  }

  // Expose NDK instance for direct access when needed
  public get ndkInstance(): NDK {
    return this.ndk;
  }
}

// Export a singleton instance
export const nostrService = NostrService.getInstance(); 