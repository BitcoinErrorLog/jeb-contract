/**
 * Adapter surface any bot under test must implement.
 * Implementation-independent: the harness never imports bot internals.
 */

export interface ContractEnv {
  /** Base URL of the Nexus the bot must poll (fixture server during contract runs). */
  nexusUrl: string;
  /** Homeserver public key (z-base-32), e.g. static testnet `8pinxxg…`. */
  homeserverPk: string;
  /** Single-use signup token from the homeserver admin API. */
  signupToken: string;
  /** 32-byte Ed25519 secret as lowercase hex. */
  secretKeyHex: string;
  /** Optional Postgres URL if the bot keeps its own offset/idempotency store. */
  pgUrl?: string;
  /** Text the bot should publish when it would otherwise call a model. */
  cannedReply: string;
  /** Simulated model latency the bot must honor before publishing. */
  modelDelayMs: number;
  /**
   * Maximum number of replies this bot may publish in one thread
   * (root post + descendants). Contract default is 1.
   */
  maxRepliesPerThread: number;
}

export interface AncestorContextEntry {
  uri: string;
  createdAt: number;
}

export interface DebugLastContext {
  ancestors: AncestorContextEntry[];
}

export interface BotAdapter {
  start(env: ContractEnv): Promise<void>;
  stop(): Promise<void>;
  /**
   * Optional hook. If present, HAPPY/ancestor tests may assert created_at order.
   * Bots that do not implement it still pass as long as they publish a valid reply.
   */
  debugLastContext?(): DebugLastContext | undefined;
}
