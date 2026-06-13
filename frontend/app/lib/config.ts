// Build-time deployment configuration. NEXT_PUBLIC_* vars are inlined by Next
// at build time, so each deployment (Docker image / hosted build) bakes in its
// own node + app defaults. The header Settings panel can still override
// node/app at runtime for dev and ops; overrides are kept in localStorage.

export const envConfig = {
  nodeUrl: process.env.NEXT_PUBLIC_NODE_URL || "http://localhost:8080",
  appName: process.env.NEXT_PUBLIC_APP_NAME || "app",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337"),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "",
};
