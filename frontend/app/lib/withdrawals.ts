import { type Output as CartesiOutput } from "@cartesi/viem";
import type { AppConfig } from "./cartesi";
import { getInspectOptions } from "./cartesi";
import { indexerQuery } from "../backend-libs/indexer/lib";
import {
  queryOutput,
  ensureCartesiPublicClient,
  type BaseLayerWalletClient,
} from "../backend-libs/cartesapp/utils";
import type { Hex } from "viem";

// Ether withdrawals are two-step on Cartesi: the WithdrawEther input debits
// the in-app wallet and emits a voucher; once the epoch settles and the node
// computes the proof, the voucher can be executed on the base layer to
// actually transfer the ETH. These helpers list a user's withdrawal vouchers
// and execute the claimable ones.

export type WithdrawalStatus = "waiting_proof" | "claimable" | "claimed";

export interface Withdrawal {
  output: CartesiOutput;
  amount: number; // ETH
  status: WithdrawalStatus;
  createdAt?: Date;
}

function statusOf(output: CartesiOutput): WithdrawalStatus {
  if (output.executionTransactionHash != null) return "claimed";
  if (output.hash && output.outputHashesSiblings?.length) return "claimable";
  return "waiting_proof";
}

export async function listEtherWithdrawals(
  config: AppConfig,
  userAddress: string,
): Promise<Withdrawal[]> {
  // Tags as emitted by cartesapplib's WithdrawEther handler; wallet owners
  // are stored lowercase.
  const indexerOutput: any = await indexerQuery(
    {
      tags: ["wallet", "ether", "withdrawal", userAddress.toLowerCase()],
      type: "voucher",
      order_by: "input_index",
      order_dir: "desc",
      page_size: 50,
    },
    {
      ...getInspectOptions(config),
      decode: true,
      decodeModel: "IndexerOutput",
    },
  );

  const rpcOptions = await ensureCartesiPublicClient({
    applicationAddress: config.appAddress,
    cartesiNodeUrl: config.nodeAddress,
  });

  const outputs = await Promise.all(
    (indexerOutput.data as Array<{ output_index: bigint }>).map((entry) =>
      queryOutput(rpcOptions, BigInt(entry.output_index)),
    ),
  );

  return outputs
    .filter((o) => o.decodedData?.type === "Voucher")
    .map((o) => ({
      output: o,
      amount:
        o.decodedData?.type === "Voucher"
          ? Number(o.decodedData.value) / 1e18
          : 0,
      status: statusOf(o),
      createdAt: o.createdAt ? new Date(o.createdAt) : undefined,
    }));
}

export async function executeWithdrawal(
  withdrawal: Withdrawal,
  appAddress: Hex,
  client: BaseLayerWalletClient,
): Promise<Hex | undefined> {
  const output = withdrawal.output;
  if (!output.hash || !output.outputHashesSiblings?.length)
    throw new Error("Voucher has no proof yet — wait for the epoch to settle");
  const [address] = await client.requestAddresses();
  if (!address) throw new Error("No account connected");
  return await client.executeOutput({
    application: appAddress,
    output,
    account: address,
    chain: client.chain,
  });
}
