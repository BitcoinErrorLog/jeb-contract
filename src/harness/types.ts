export type HomeserverMode = "pubky-testnet" | "staging";

export interface HarnessRuntime {
  mode: HomeserverMode;
  homeserverPk: string;
  adminUrl: string;
  pgUrl: string;
  testnet: boolean;
}
