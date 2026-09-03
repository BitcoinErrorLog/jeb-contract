import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { BotAdapter } from "../adapter.js";

export async function loadAdapter(): Promise<BotAdapter> {
  const specified = process.env.CONTRACT_ADAPTER;
  const target = specified
    ? pathToFileURL(resolve(specified)).href
    : new URL("../reference-adapter/index.ts", import.meta.url).href;
  const mod = (await import(target)) as {
    default?: new () => BotAdapter;
    adapter?: BotAdapter;
    ReferenceAdapter?: new () => BotAdapter;
  };
  if (mod.adapter) return mod.adapter;
  const Ctor = mod.default ?? mod.ReferenceAdapter;
  if (!Ctor) {
    throw new Error(`Adapter module ${target} must export default class, ReferenceAdapter, or adapter`);
  }
  return new Ctor();
}
