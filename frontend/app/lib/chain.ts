import { defineChain, type Chain } from "viem";
import {
  anvil,
  mainnet,
  sepolia,
  holesky,
  base,
  baseSepolia,
  optimism,
  optimismSepolia,
  arbitrum,
  arbitrumSepolia,
} from "viem/chains";
import { envConfig } from "./config";

const KNOWN_CHAINS: Chain[] = [
  anvil,
  mainnet,
  sepolia,
  holesky,
  base,
  baseSepolia,
  optimism,
  optimismSepolia,
  arbitrum,
  arbitrumSepolia,
];

// Base-layer chain for the deployment, resolved from NEXT_PUBLIC_CHAIN_ID.
// Unknown ids fall back to a generic chain definition using
// NEXT_PUBLIC_RPC_URL (or the wallet's own provider when empty).
export const appChain: Chain =
  KNOWN_CHAINS.find((c) => c.id === envConfig.chainId) ??
  defineChain({
    id: envConfig.chainId,
    name: `Chain ${envConfig.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: envConfig.rpcUrl ? [envConfig.rpcUrl] : [] },
    },
  });
