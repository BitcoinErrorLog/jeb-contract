/**
 * Adapter surface any bot under test must implement.
 * Implementation-independent: the harness never imports bot internals.
 */
export type {
  AncestorContextEntry,
  BotAdapter,
  ContractEnv,
  DebugLastContext,
} from "../types.js";
