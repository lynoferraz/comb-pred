#!/usr/bin/env node
/**
 * Seed the CIM prediction market with the demo "2026 Outlook" model.
 *
 * Reads the shared model from app/lib/market-model.json and, acting as the
 * operator account, performs the full on-chain initialization sequence:
 *
 *   1. deposit ether to the app (funds the AMM, whose balance is the
 *      operator/amm_id wallet balance);
 *   2. initialize_amm(b)            -> via initializeAmm() from backend-libs;
 *   3. add_variable(...) per variable -> via addVariable() from backend-libs,
 *      in dependency order, attaching each one to the right clique so the
 *      junction tree comes out as the four thematic clusters
 *      (Economy, Politics, Markets, Sports).
 *
 * The mutations are issued with the project's generated client library
 * (app/backend-libs/cim/lib.ts) so the on-chain encoding stays in lock-step
 * with the frontend. This file is run through scripts/register-ts.mjs, which
 * lets plain Node import those TypeScript modules (see `npm run seed`).
 *
 * Configuration via environment variables (sensible local-anvil defaults):
 *   NODE_URL        Cartesi node URL          (default http://localhost:8080)
 *   APP_NAME        Application name/slug     (default app)
 *   APP_ADDRESS     Application address       (default: resolved from APP_NAME)
 *   OPERATOR_KEY    Operator private key      (default anvil account #0)
 *   L1_RPC          Base-layer RPC URL        (default: anvil chain default)
 *   RESOLVE_ADDRESS Resolver for variables    (default: operator address)
 *   INFO_BASE_URL   Base for info_url values  (default "" -> relative /api/info/<alias>)
 *   B_PARAM         AMM liquidity parameter b in ETH (default from model file)
 *   AMM_DEPOSIT     Ether to deposit to fund the AMM, in ETH (default from model file)
 *   SKIP_DEPOSIT    If set, skip the funding deposit step
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createWalletClient, http, parseEther, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { walletActionsL1 } from "@cartesi/viem";

import { initializeAmm, addVariable } from "../app/backend-libs/cim/lib.ts";
import { getAppAddress } from "../app/backend-libs/cartesapp/utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---------------------------------------------------------------

const NODE_URL = process.env.NODE_URL || "http://localhost:8080";
const APP_NAME = process.env.APP_NAME || "app";
// Anvil account #0 — the default operator/admin address in core_settings.py.
const OPERATOR_KEY =
  process.env.OPERATOR_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const INFO_BASE_URL = process.env.INFO_BASE_URL || "";

const model = JSON.parse(
  readFileSync(resolve(__dirname, "../app/lib/market-model.json"), "utf8"),
);
const bEth = process.env.B_PARAM || model.b;
const depositEth = process.env.AMM_DEPOSIT || model.ammDeposit;

// --- Helpers --------------------------------------------------------------

// 16-byte fixed alias name right-padded into a bytes32 word — byte-identical
// to the admin UI's strToBytes32 helper.
function strToBytes32(s) {
  const hex = Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "0x" + hex.padEnd(64, "0");
}

const infoUrl = (alias) => `${INFO_BASE_URL}/api/info/${alias}`;

// --- Client ---------------------------------------------------------------

const account = privateKeyToAccount(OPERATOR_KEY);
const wallet = createWalletClient({
  account,
  chain: anvil,
  transport: http(process.env.L1_RPC),
}).extend(walletActionsL1());

const resolveAddress = getAddress(process.env.RESOLVE_ADDRESS || account.address);

// --- Main -----------------------------------------------------------------

async function main() {
  const appAddress =
    (process.env.APP_ADDRESS && getAddress(process.env.APP_ADDRESS)) ||
    (await getAppAddress(APP_NAME, NODE_URL));
  if (!appAddress) throw new Error(`Could not resolve app address for "${APP_NAME}"`);

  const mutationOpts = { applicationAddress: appAddress, client: wallet };

  console.log(`Operator   : ${account.address}`);
  console.log(`Node URL   : ${NODE_URL}`);
  console.log(`App address: ${appAddress}`);
  console.log(`b          : ${bEth} ETH\n`);

  if (!process.env.SKIP_DEPOSIT) {
    console.log(`Depositing ${depositEth} ETH to fund the AMM...`);
    const hash = await wallet.depositEther({
      application: appAddress,
      value: parseEther(String(depositEth)),
      account: account.address,
      chain: anvil,
      execLayerData: "0x",
    });
    console.log(`  funded (tx ${hash})`);
  }

  console.log(`Initializing AMM (b = ${bEth} ETH)...`);
  await initializeAmm(
    { b: BigInt(Math.round(parseFloat(bEth) * 1e18)) },
    mutationOpts,
  );
  console.log("  initialized");

  console.log(`Adding ${model.variables.length} variables...`);
  for (const v of model.variables) {
    const joins =
      v.related && v.related.length > 0
        ? `joins clique of [${v.related.join(", ")}]`
        : `new cluster (${v.cluster})`;
    process.stdout.write(
      `  + ${v.alias.padEnd(10)} ${v.states.length} states  ${joins} ... `,
    );
    await addVariable(
      {
        alias: strToBytes32(v.alias),
        n_states: BigInt(v.states.length),
        resolve_address: resolveAddress,
        related_aliases: (v.related || []).map(strToBytes32),
        related_aliases2: [],
        related_aliases3: [],
        info_url: infoUrl(v.alias),
      },
      mutationOpts,
    );
    console.log("ok");
  }

  console.log("\nDone. The market now holds the 2026 Outlook model.");
}

main().catch((err) => {
  console.error("\nSeed failed:", err.shortMessage || err.message || err);
  process.exit(1);
});
