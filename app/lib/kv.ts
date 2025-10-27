import { Redis } from "@upstash/redis";
export const kv = Redis.fromEnv(); // uses UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
export const get  = <T=unknown>(k:string) => kv.get<T>(k);
export const set  = (k:string, v:unknown) => kv.set(k, v);
export const del  = (k:string) => kv.del(k);
export const keys = (p:string) => kv.keys(p);
