// lib/kv.d.ts
declare module "lib/kv" {
  export const kv: {
    get: <T = any>(key: string) => Promise<T | null>;
    set: (key: string, value: any, opts?: { ex?: number; px?: number }) => Promise<unknown>;
    del: (key: string) => Promise<unknown>;
    keys: (pattern: string) => Promise<string[]>;
    hget: <T = any>(key: string, field: string) => Promise<T | null>;
    hset: (key: string, data: Record<string, any>) => Promise<unknown>;
  };
  export const ns: (key: string) => string;
}
