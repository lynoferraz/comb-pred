"use client";

import { useState } from "react";
import Link from "next/link";
import { parseEther } from "viem";
import { useApp } from "../lib/context";
import { useToast } from "./ui/Toast";
import Modal from "./ui/Modal";
import { withdrawEther } from "../backend-libs/cim/lib";
import { fmt } from "../lib/format";

export default function WithdrawModal({ onClose }: { onClose: () => void }) {
  const { appAddress, walletClient, userFreeFunds, refreshUserInfo } = useApp();
  const { toast, updateToast } = useToast();

  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const free = userFreeFunds ?? 0;
  const parsed = parseFloat(amount);
  const invalid = !amount || isNaN(parsed) || parsed <= 0 || parsed > free;

  const handleWithdraw = async () => {
    if (invalid || !appAddress || !walletClient) return;
    setLoading(true);
    const id = toast("pending", "Requesting withdrawal…", `${amount} ETH`);
    try {
      await withdrawEther(
        { amount: parseEther(amount), exec_layer_data: "0x" } as any,
        { applicationAddress: appAddress, client: walletClient },
      );
      updateToast(
        id,
        "success",
        "Withdrawal requested",
        "Claim it from your Portfolio once the proof is ready.",
      );
      setAmount("");
      await refreshUserInfo();
      onClose();
    } catch (err: any) {
      updateToast(id, "error", "Withdrawal failed", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Withdraw ETH" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="flex justify-between items-baseline mb-2">
            <label className="text-[11px] font-medium text-ink3 uppercase tracking-widest">
              Amount (ETH)
            </label>
            <button
              onClick={() => setAmount(String(free))}
              className="text-[11px] font-medium text-accent-deep hover:underline"
            >
              Max {fmt.eth(free, 4)}
            </button>
          </div>
          <input
            type="number"
            step="0.001"
            min="0"
            max={free}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 0.002"
            className="w-full bg-line2 border border-line rounded-xl px-4 py-3 text-sm outline-none focus:border-ink4"
          />
        </div>
        <p className="text-xs text-ink2 leading-relaxed">
          Withdrawing is a two-step process: this request frees the funds from
          the market, then the resulting voucher must be claimed on the base
          layer from your{" "}
          <Link href="/dashboard" className="underline hover:text-ink">
            Portfolio
          </Link>{" "}
          once its proof is ready.
        </p>
        <button
          onClick={handleWithdraw}
          disabled={loading || invalid}
          className="w-full bg-ink text-surface font-semibold py-3.5 rounded-xl text-sm disabled:opacity-50 transition-opacity hover:opacity-90"
        >
          {loading ? "Requesting…" : "Request Withdrawal"}
        </button>
      </div>
    </Modal>
  );
}
