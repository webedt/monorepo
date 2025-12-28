/**
 * Offline Storage Service
 * IndexedDB-based storage for offline caching of files and data
 */

const DB_NAME = 'webedt-offline';
const DB_VERSION = 1;

interface CachedFile {
  key: string;
  sessionPath: string;
  filePath: string;
  content: string | ArrayBuffer;
  contentType: 'text' | 'binary';
  timestamp: number;
  dirty: boolean;
}

interface CachedSession {
  sessionId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface CacheMetadata {
  key: string;
  size: number;
  lastAccess: number;
}

class OfflineStorage {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private maxCacheSize = 50 * 1024 * 1024; // 50MB max cache

  /**
   * Initialize the database
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.dbPromise) {
      await this.dbPromise;
      return;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[OfflineStorage] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Files store for cached file content
        if (!db.objectStoreNames.contains('files')) {
          const filesStore = db.createObjectStore('files', { keyPath: 'key' });
          filesStore.createIndex('sessionPath', 'sessionPath', { unique: false });
          filesStore.createIndex('dirty', 'dirty', { unique: false });
          filesStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Sessions store for cached session data
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'sessionId' });
        }

        // Metadata store for cache management
        if (!db.objectStoreNames.contains('metadata')) {
          const metaStore = db.createObjectStore('metadata', { keyPath: 'key' });
          metaStore.createIndex('lastAccess', 'lastAccess', { unique: false });
        }
      };
    });

    await this.dbPromise;
  }

  /**
   * Get the database instance
   */
  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    return this.db!;
  }

  /**
   * Generate a cache key for a file
   */
  private getFileKey(sessionPath: string, filePath: string): string {
    return `${sessionPath}:${filePath}`;
  }

  /**
   * Cache a file for offline access
   */
  async cacheFile(
    sessionPath: string,
    filePath: string,
    content: string | ArrayBuffer,
    contentType: 'text' | 'binary' = 'text'
  ): Promise<void> {
    const db = await this.getDb();
    const key = this.getFileKey(sessionPath, filePath);
    const size = typeof content === 'string' ? content.length : content.byteLength;

    // Check cache size and evict if needed
    await this.ensureCacheSpace(size);

    const transaction = db.transaction(['files', 'metadata'], 'readwrite');
    const filesStore = transaction.objectStore('files');
    const metaStore = transaction.objectStore('metadata');

    const cachedFile: CachedFile = {
      key,
      sessionPath,
      filePath,
      content,
      contentType,
      timestamp: Date.now(),
      dirty: false,
    };

    const metadata: CacheMetadata = {
      key,
      size,
      lastAccess: Date.now(),
    };

    await Promise.all([
      this.promisifyRequest(filesStore.put(cachedFile)),
      this.promisifyRequest(metaStore.put(metadata)),
    ]);
  }

  /**
   * Get a cached file
   */
  async getCachedFile(
    sessionPath: string,
    filePath: string
  ): Promise<{ content: string | ArrayBuffer; contentType: 'text' | 'binary' } | null> {
    const db = await this.getDb();
    const key = this.getFileKey(sessionPath, filePath);

    const transaction = db.transaction(['files', 'metadata'], 'readwrite');
    const filesStore = transaction.objectStore('files');
    const metaStore = transaction.objectStore('metadata');

    const result = await this.promisifyRequest<CachedFile | undefined>(filesStore.get(key));

    if (result) {
      // Update last access time
      const metadata = await this.promisifyRequest<CacheMetadata | undefined>(metaStore.get(key));
      if (metadata) {
        metadata.lastAccess = Date.now();
        await this.promisifyRequest(metaStore.put(metadata));
      }

      return {
        content: result.content,
        contentType: result.contentType,
      };
    }

    return null;
  }

  /**
   * Save a file locally (mark as dirty for later sync)
   */
  async saveFileLocally(
    sessionPath: string,
    filePath: string,
    content: string | ArrayBuffer,
    contentType: 'text' | 'binary' = 'text'
  ): Promise<void> {
    const db = await this.getDb();
    const key = this.getFileKey(sessionPath, filePath);
    const size = typeof content === 'string' ? content.length : content.byteLength;

    await this.ensureCacheSpace(size);

    const transaction = db.transaction(['files', 'metadata'], 'readwrite');
    const filesStore = transaction.objectStore('files');
    const metaStore = transaction.objectStore('metadata');

    const cachedFile: CachedFile = {
      key,
      sessionPath,
      filePath,
      content,
      contentType,
      timestamp: Date.now(),
      dirty: true, // Mark as needing sync
    };

    const metadata: CacheMetadata = {
      key,
      size,
      lastAccess: Date.now(),
    };

    await Promise.all([
      this.promisifyRequest(filesStore.put(cachedFile)),
      this.promisifyRequest(metaStore.put(metadata)),
    ]);
  }

  /**
   * Get all dirty files that need syncing
   */
  async getDirtyFiles(): Promise<CachedFile[]> {
    const db = await this.getDb();
    const transaction = db.transaction('files', 'readonly');
    const store = transaction.objectStore('files');
    const index = store.index('dirty');

    return this.promisifyRequest<CachedFile[]>(index.getAll(IDBKeyRange.only(true)));
  }

  /**
   * Mark a file as synced (no longer dirty)
   */
  async markFileSynced(sessionPath: string, filePath: string): Promise<void> {
    const db = await this.getDb();
    const key = this.getFileKey(sessionPath, filePath);
    const transaction = db.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');

    const file = await this.promisifyRequest<CachedFile | undefined>(store.get(key));
    if (file) {
      file.dirty = false;
      file.timestamp = Date.now();
      await this.promisifyRequest(store.put(file));
    }
  }

  /**
   * Cache session data
   */
  async cacheSession(sessionId: string, data: Record<string, unknown>): Promise<void> {
    const db = await this.getDb();
    const transaction = db.transaction('sessions', 'readwrite');
    const store = transaction.objectStore('sessions');

    const cachedSession: CachedSession = {
      sessionId,
      data,
      timestamp: Date.now(),
    };

    await this.promisifyRequest(store.put(cachedSession));
  }

  /**
   * Get cached session data
   */
  async getCachedSession(sessionId: string): Promise<Record<string, unknown> | null> {
    const db = await this.getDb();
    const transaction = db.transaction('sessions', 'readonly');
    const store = transaction.objectStore('sessions');

    const result = await this.promisifyRequest<CachedSession | undefined>(store.get(sessionId));
    return result?.data || null;
  }

  /**
   * Get all files cached for a session
   */
  async getSessionFiles(sessionPath: string): Promise<string[]> {
    const db = await this.getDb();
    const transaction = db.transaction('files', 'readonly');
    const store = transaction.objectStore('files');
    const index = store.index('sessionPath');

    const files = await this.promisifyRequest<CachedFile[]>(
      index.getAll(IDBKeyRange.only(sessionPath))
    );

    return files.map(f => f.filePath);
  }

  /**
   * Clear cached files for a session
   */
  async clearSessionCache(sessionPath: string): Promise<void> {
    const db = await this.getDb();
    const transaction = db.transaction(['files', 'metadata'], 'readwrite');
    const filesStore = transaction.objectStore('files');
    const metaStore = transaction.objectStore('metadata');
    const index = filesStore.index('sessionPath');

    const files = await this.promisifyRequest<CachedFile[]>(
      index.getAll(IDBKeyRange.only(sessionPath))
    );

    for (const file of files) {
      await this.promisifyRequest(filesStore.delete(file.key));
      await this.promisifyRequest(metaStore.delete(file.key));
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalSize: number;
    fileCount: number;
    dirtyCount: number;
    oldestFile: number | null;
  }> {
    const db = await this.getDb();
    const transaction = db.transaction(['files', 'metadata'], 'readonly');
    const filesStore = transaction.objectStore('files');
    const metaStore = transaction.objectStore('metadata');

    const [files, metadata] = await Promise.all([
      this.promisifyRequest<CachedFile[]>(filesStore.getAll()),
      this.promisifyRequest<CacheMetadata[]>(metaStore.getAll()),
    ]);

    const totalSize = metadata.reduce((sum, m) => sum + m.size, 0);
    const dirtyCount = files.filter(f => f.dirty).length;
    const oldestFile = files.length > 0
      ? Math.min(...files.map(f => f.timestamp))
      : null;

    return {
      totalSize,
      fileCount: files.length,
      dirtyCount,
      oldestFile,
    };
  }

  /**
   * Ensure enough space in cache by evicting old entries
   */
  private async ensureCacheSpace(requiredSpace: number): Promise<void> {
    const stats = await this.getCacheStats();

    if (stats.totalSize + requiredSpace <= this.maxCacheSize) {
      return;
    }

    const db = await this.getDb();
    const transaction = db.transaction(['files', 'metadata'], 'readwrite');
    const filesStore = transaction.objectStore('files');
    const metaStore = transaction.objectStore('metadata');
    const index = metaStore.index('lastAccess');

    // Get all metadata sorted by last access (oldest first)
    const cursor = index.openCursor();
    let freedSpace = 0;
    const targetSpace = requiredSpace + (this.maxCacheSize * 0.1); // Free 10% extra

    await new Promise<void>((resolve, reject) => {
      cursor.onsuccess = async () => {
        const result = cursor.result;
        if (!result || freedSpace >= targetSpace) {
          resolve();
          return;
        }

        const meta = result.value as CacheMetadata;

        // Don't evict dirty files
        const file = await this.promisifyRequest<CachedFile | undefined>(
          filesStore.get(meta.key)
        );

        if (file && !file.dirty) {
          freedSpace += meta.size;
          await this.promisifyRequest(filesStore.delete(meta.key));
          await this.promisifyRequest(metaStore.delete(meta.key));
        }

        result.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }

  /**
   * Clear all cached data
   */
  async clearAll(): Promise<void> {
    const db = await this.getDb();
    const transaction = db.transaction(['files', 'sessions', 'metadata'], 'readwrite');

    await Promise.all([
      this.promisifyRequest(transaction.objectStore('files').clear()),
      this.promisifyRequest(transaction.objectStore('sessions').clear()),
      this.promisifyRequest(transaction.objectStore('metadata').clear()),
    ]);
  }

  /**
   * Promisify an IDB request
   */
  private promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// Export singleton instance
export const offlineStorage = new OfflineStorage();

// Initialize on import
offlineStorage.init().catch(console.error);
