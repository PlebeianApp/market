import NDK from "@nostr-dev-kit/ndk";
import NDKCacheAdapterDexie from "@nostr-dev-kit/ndk-cache-dexie";

class NostrService {
  private static instance: NostrService;
  private ndk: NDK;
  private _isConnecting: boolean = false;
  private _isConnected: boolean = false;

  private constructor() {
    const dexieAdapter = new NDKCacheAdapterDexie({ dbName: 'nostr-cache' });
    this.ndk = new NDK({
      // cacheAdapter: dexieAdapter,
      explicitRelayUrls: [
        "wss://relay.nostr.net",
        // Add more default relays as needed
      ],
    });
  }

  public static getInstance(): NostrService {
    if (!NostrService.instance) {
      NostrService.instance = new NostrService();
    }
    return NostrService.instance;
  }

  public async connect(): Promise<void> {
    if (this._isConnected || this._isConnecting) return;
    
    this._isConnecting = true;
    try {
      await this.ndk.connect();
      this._isConnected = true;
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