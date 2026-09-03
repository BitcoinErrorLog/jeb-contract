export interface HarnessRuntime {
  mode: "pubky-testnet" | "fallback-http";
  homeserverPk: string;
  adminHost: string;
  pgUrl: string;
  fallbackUrl?: string;
  fallbackReason?: string;
}
