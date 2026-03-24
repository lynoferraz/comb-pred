"use client";

import { useState } from "react";
import Link from "next/link";
import { parseEther, toHex } from "viem";
import { anvil } from "viem/chains";
import { useApp } from "../lib/context";
import { getClient, getWalletClient } from "../backend-libs/cartesapp/utils";
import { BarChart3, Wallet, Download, LogOut, X } from "lucide-react";

export default function Header() {
  const {
    nodeAddress,
    setNodeAddress,
    appName,
    setAppName,
    appAddress,
    walletAddress,
    connect,
    disconnect,
    isOperator,
  } = useApp();

  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositSuccess, setDepositSuccess] = useState(false);

  const handleDeposit = async () => {
    if (!depositAmount || !appAddress) return;
    setDepositLoading(true);
    setDepositError(null);
    setDepositSuccess(false);
    try {
      const client = await getClient(anvil);
      const wc = await getWalletClient(anvil);
      if (!client || !wc) throw new Error("Could not get client");
      const [address] = await wc.requestAddresses();
      if (!address) throw new Error("No account");
      const value = parseEther(depositAmount);
      const data = toHex(`Deposited (${value}) ether.`);
      const txHash = await wc.depositEther({
        application: appAddress,
        value,
        account: address,
        chain: anvil,
        execLayerData: data,
      });
      await client.waitForTransactionReceipt({ hash: txHash });
      setDepositSuccess(true);
      setDepositAmount("");
    } catch (err: any) {
      setDepositError(err.message || "Deposit failed");
    } finally {
      setDepositLoading(false);
    }
  };

  const closeDeposit = () => {
    setShowDeposit(false);
    setDepositError(null);
    setDepositSuccess(false);
  };

  return (
    <>
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
      <div className="max-w-[1400px] mx-auto px-8 h-20 flex items-center justify-between">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center gap-2 group no-underline">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white group-hover:bg-blue-600 transition-colors shadow-lg shadow-slate-200">
              <BarChart3 size={20} strokeWidth={3} />
            </div>
            <h1 className="text-2xl font-black tracking-tighter uppercase text-slate-900 italic">CIM</h1>
          </Link>

          <nav className="hidden md:flex items-center gap-2">
            <Link
              href="/"
              className="px-6 py-2 rounded-xl text-sm font-black text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all no-underline"
            >
              MARKETS
            </Link>
            <Link
              href="/dashboard"
              className="px-6 py-2 rounded-xl text-sm font-black text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all no-underline"
            >
              PORTFOLIO
            </Link>
            {isOperator && (
              <Link
                href="/admin"
                className="px-6 py-2 rounded-xl text-sm font-black text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all no-underline"
              >
                ADMIN
              </Link>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-3">
            <input
              type="text"
              value={nodeAddress}
              onChange={(e) => setNodeAddress(e.target.value)}
              placeholder="Node URL"
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs w-44 focus:ring-2 ring-blue-500/10 outline-none"
            />
            <input
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="App"
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs w-20 focus:ring-2 ring-blue-500/10 outline-none"
            />
          </div>

          {walletAddress ? (
            <div className="flex items-center gap-3">
              <div className="hidden lg:flex flex-col items-end">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Connected</div>
                <div className="text-xs font-bold text-slate-900 font-mono">
                  {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                </div>
              </div>
              <div className="h-10 w-px bg-slate-200" />
              {appAddress && (
                <button
                  onClick={() => setShowDeposit(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <Download size={14} /> Deposit
                </button>
              )}
              <button
                onClick={disconnect}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-400 hover:text-red-500 hover:border-red-200 transition-colors"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              className="bg-slate-900 hover:bg-black text-white px-6 py-3 rounded-2xl text-xs font-black flex items-center gap-2 shadow-lg shadow-slate-200 transition-all active:scale-95"
            >
              <Wallet size={16} /> Connect Wallet
            </button>
          )}
        </div>
      </div>

      {appAddress && (
        <div className="max-w-[1400px] mx-auto px-8 pb-2">
          <span className="text-[10px] text-slate-400 font-mono font-bold tracking-tight">
            APP: {appAddress}
          </span>
        </div>
      )}

    </header>

    {/* Deposit Modal — rendered outside header so backdrop covers full screen */}
    {showDeposit && (
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={closeDeposit}>
        <div className="bg-white border border-slate-200 rounded-3xl p-8 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-black text-slate-900">Deposit ETH</h2>
            <button onClick={closeDeposit} className="text-slate-400 hover:text-slate-900 transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Amount (ETH)</label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="e.g. 0.5"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 ring-blue-500/10 outline-none"
              />
            </div>
            {depositError && (
              <div className="text-red-500 text-xs font-bold bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {depositError}
              </div>
            )}
            {depositSuccess && (
              <div className="text-emerald-600 text-xs font-bold bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                Deposit successful!
              </div>
            )}
            <button
              onClick={handleDeposit}
              disabled={depositLoading || !depositAmount}
              className="w-full bg-slate-900 hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed text-white font-black py-4 rounded-2xl text-xs transition-all"
            >
              {depositLoading ? "Depositing..." : "Deposit"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
