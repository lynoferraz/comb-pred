"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { parseEther } from "viem";
import { anvil } from "viem/chains";
import { useApp } from "../lib/context";
import { useTheme } from "../lib/theme";
import { getClient, getWalletClient } from "../backend-libs/cartesapp/utils";
import { fmt } from "../lib/format";
import { Moon, Sun, Download, LogOut, X, Settings } from "lucide-react";

const NAV = [
  { name: "Markets", href: "/" },
  { name: "Portfolio", href: "/dashboard" },
  { name: "Explorer", href: "/explorer" },
];

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
    userFreeFunds,
  } = useApp();
  const { dark, toggleDark } = useTheme();
  const pathname = usePathname();

  const [showDeposit, setShowDeposit] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositSuccess, setDepositSuccess] = useState(false);

  const activeName =
    pathname === "/dashboard"
      ? "Portfolio"
      : pathname.startsWith("/explorer")
        ? "Explorer"
        : pathname.startsWith("/admin")
          ? "Admin"
          : "Markets";

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
      const txHash = await wc.depositEther({
        application: appAddress,
        value,
        account: address,
        chain: anvil,
        execLayerData: "0x",
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
      <header className="sticky top-0 z-50 border-b border-line bg-surface">
        <div className="max-w-[1500px] mx-auto px-7 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 no-underline">
              <div className="w-[26px] h-[26px] rounded-[7px] bg-ink grid place-items-center text-accent font-mono text-sm font-bold">
                ◆
              </div>
              <span className="font-semibold text-base text-ink tracking-tight">
                cim
              </span>
            </Link>
            <nav className="hidden md:flex items-center gap-6">
              {NAV.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`py-1.5 text-sm font-medium no-underline border-b-2 transition-colors ${
                    activeName === item.name
                      ? "text-ink border-ink"
                      : "text-ink2 border-transparent hover:text-ink"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
              {isOperator && (
                <Link
                  href="/admin"
                  className={`py-1.5 text-sm font-medium no-underline border-b-2 transition-colors ${
                    activeName === "Admin"
                      ? "text-ink border-ink"
                      : "text-ink2 border-transparent hover:text-ink"
                  }`}
                >
                  Admin
                </Link>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowConfig((v) => !v)}
              title="Node settings"
              className="p-2 rounded-full text-ink3 hover:text-ink hover:bg-line2 transition-colors"
            >
              <Settings size={16} />
            </button>
            <button
              onClick={toggleDark}
              title="Toggle theme"
              className="p-2 rounded-full text-ink3 hover:text-ink hover:bg-line2 transition-colors"
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {walletAddress && userFreeFunds !== undefined && (
              <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 bg-line2 rounded-full text-[13px] text-ink2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="font-mono">{fmt.eth(userFreeFunds, 4)} ETH</span>
              </div>
            )}

            {appAddress && walletAddress && (
              <button
                onClick={() => setShowDeposit(true)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line text-[13px] font-medium text-ink2 hover:bg-line2 transition-colors"
              >
                <Download size={13} /> Deposit
              </button>
            )}

            {walletAddress ? (
              <button
                onClick={disconnect}
                className="flex items-center gap-2 bg-ink text-surface px-4 py-2 rounded-full text-[13px] font-medium hover:opacity-90 transition-opacity"
                title="Disconnect"
              >
                <span className="font-mono">{fmt.addr(walletAddress)}</span>
                <LogOut size={13} />
              </button>
            ) : (
              <button
                onClick={connect}
                className="bg-ink text-surface px-4 py-2 rounded-full text-[13px] font-medium hover:opacity-90 transition-opacity"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>

        {showConfig && (
          <div className="border-t border-line bg-surface2">
            <div className="max-w-[1500px] mx-auto px-7 py-3 flex flex-wrap items-center gap-3">
              <label className="text-[11px] font-medium text-ink3 uppercase tracking-wide">
                Node
              </label>
              <input
                type="text"
                value={nodeAddress}
                onChange={(e) => setNodeAddress(e.target.value)}
                placeholder="Node URL"
                className="bg-surface border border-line rounded-lg px-3 py-1.5 text-xs w-56 outline-none focus:border-ink4"
              />
              <label className="text-[11px] font-medium text-ink3 uppercase tracking-wide">
                App
              </label>
              <input
                type="text"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="App"
                className="bg-surface border border-line rounded-lg px-3 py-1.5 text-xs w-24 outline-none focus:border-ink4"
              />
              {appAddress && (
                <span className="text-[11px] text-ink3 font-mono ml-auto">
                  {appAddress}
                </span>
              )}
            </div>
          </div>
        )}
      </header>

      {showDeposit && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100]"
          onClick={closeDeposit}
        >
          <div
            className="bg-surface border border-line rounded-3xl p-8 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-ink">Deposit ETH</h2>
              <button
                onClick={closeDeposit}
                className="text-ink3 hover:text-ink transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-medium text-ink3 uppercase tracking-widest block mb-2">
                  Amount (ETH)
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="e.g. 0.002"
                  className="w-full bg-line2 border border-line rounded-xl px-4 py-3 text-sm outline-none focus:border-ink4"
                />
              </div>
              {depositError && (
                <div className="text-no text-xs font-medium bg-no-soft border border-no/30 rounded-xl px-4 py-3">
                  {depositError}
                </div>
              )}
              {depositSuccess && (
                <div className="text-accent-deep text-xs font-medium bg-accent-soft border border-accent/30 rounded-xl px-4 py-3">
                  Deposit successful!
                </div>
              )}
              <button
                onClick={handleDeposit}
                disabled={depositLoading || !depositAmount}
                className="w-full bg-ink text-surface font-semibold py-3.5 rounded-xl text-sm disabled:opacity-50 transition-opacity hover:opacity-90"
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
