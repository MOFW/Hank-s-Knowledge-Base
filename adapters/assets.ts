import { env } from "cloudflare:workers";

export interface AssetStore {
  put(key: string, body: ReadableStream | ArrayBuffer, options?: R2PutOptions): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
  delete(keys: string[]): Promise<void>;
}

export function getAssetStore(): AssetStore {
  const bucket = env.BUCKET;
  if (!bucket) throw new Error("BUCKET binding unavailable");
  return {
    put: (key, body, options) => bucket.put(key, body, options),
    get: (key) => bucket.get(key),
    head: (key) => bucket.head(key),
    delete: (keys) => bucket.delete(keys),
  };
}
