"use client";

import { useState, useEffect, useCallback } from "react";
import { useApp } from "../lib/context";
import { useToast } from "./ui/Toast";
import { fmt } from "../lib/format";
import {
  listEtherWithdrawals,
  executeWithdrawal,
  type Withdrawal,
} from "../lib/withdrawals";
import { RefreshCw, Upload } from "lucide-react";

const STATUS_LABEL = {
  waiting_proof: "Waiting for proof",
  claimable: "Ready to claim",
  claimed: "Claimed",
} as const;

// Lists the user's ether-withdrawal vouchers and lets them execute the
// claimable ones on the base layer (step two of the withdraw flow).
export default function WithdrawalsCard() {
  const { config, appAddress, walletAddress, walletClient } = useApp();
  const { toast, updateToast } = useToast();

  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<bigint | null>(null);

  const fetchWithdrawals = useCallback(async () => {
    if (!appAddress || !walletAddress) return;
    setLoading(true);
    try {
      setWithdrawals(await listEtherWithdrawals(config, walletAddress));
    } catch (err) {
      console.error("withdrawals fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [appAddress, walletAddress, config]);

  useEffect(() => {
    fetchWithdrawals();
  }, [fetchWithdrawals]);

  const handleClaim = async (w: Withdrawal) => {
    if (!appAddress || !walletClient) return;
    setClaiming(w.output.index);
    const id = toast("pending", "Claiming withdrawal…", `${fmt.eth(w.amount, 4)} ETH`);
    try {
      await executeWithdrawal(w, appAddress, walletClient);
      updateToast(id, "success", "Withdrawal claimed", "ETH sent to your wallet.");
      await fetchWithdrawals();
    } catch (err: any) {
      updateToast(id, "error", "Claim failed", err.message);
    } finally {
      setClaiming(null);
    }
  };

  if (withdrawals.length === 0 && !loading) return null;

  return (
    <div className="bg-surface rounded-card border border-line overflow-hidden">
      <div className="px-[22px] py-4 border-b border-line flex justify-between items-center">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <Upload size={14} className="text-ink3" /> Withdrawals
          </div>
          <div className="text-[11px] text-ink3 mt-0.5">
            Requested withdrawals become claimable once their proof is ready;
            claiming sends the ETH to your wallet on the base layer.
          </div>
        </div>
        <button
          onClick={fetchWithdrawals}
          disabled={loading}
          className="p-2 rounded-full text-ink3 hover:text-ink hover:bg-line2 disabled:opacity-50 transition-colors"
          title="Refresh withdrawals"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="divide-y divide-line2">
        {withdrawals.map((w) => (
          <div
            key={String(w.output.index)}
            className="px-[22px] py-3.5 flex items-center gap-4 text-[13px] flex-wrap"
          >
            <span className="font-mono font-semibold text-ink">
              {fmt.eth(w.amount, 6)} ETH
            </span>
            <span className="text-ink3 text-xs">
              {w.createdAt ? w.createdAt.toLocaleString() : ""}
            </span>
            <span
              className={`ml-auto px-2.5 py-1 rounded-full text-[11px] font-medium ${
                w.status === "claimed"
                  ? "bg-line2 text-ink3"
                  : w.status === "claimable"
                    ? "bg-accent-soft text-accent-deep"
                    : "bg-line2 text-ink2"
              }`}
            >
              {STATUS_LABEL[w.status]}
            </span>
            {w.status === "claimable" && (
              <button
                onClick={() => handleClaim(w)}
                disabled={claiming !== null}
                className="px-3.5 py-1.5 rounded-full bg-ink text-surface text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {claiming === w.output.index ? "Claiming…" : "Claim"}
              </button>
            )}
          </div>
        ))}
        {withdrawals.length === 0 && loading && (
          <div className="px-[22px] py-4 text-xs text-ink3 font-mono">
            <span className="cim-spinner" /> loading withdrawals…
          </div>
        )}
      </div>
    </div>
  );
}
