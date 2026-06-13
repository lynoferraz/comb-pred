"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { parseEther } from "viem";
import { appChain } from "../lib/chain";
import { useApp } from "../lib/context";
import { useTheme } from "../lib/theme";
import { getClient, getWalletClient } from "../backend-libs/cartesapp/utils";
import { fmt } from "../lib/format";
import { useToast } from "./ui/Toast";
import Modal from "./ui/Modal";
import WithdrawModal from "./WithdrawModal";
import {
  Moon,
  Sun,
  Download,
  Upload,
  LogOut,
  Settings,
  Menu,
  X,
} from "lucide-react";

const NAV = [
  { name: "Markets", href: "/" },
  { name: "Portfolio", href: "/dashboard" },
  { name: "Explorer", href: "/explorer" },
  { name: "About", href: "/about" },
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
    refreshUserInfo,
  } = useApp();
  const { dark, toggleDark } = useTheme();
  const { toast, updateToast } = useToast();
  const pathname = usePathname();

  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositLoading, setDepositLoading] = useState(false);

  const activeName =
    pathname === "/dashboard"
      ? "Portfolio"
      : pathname.startsWith("/explorer")
        ? "Explorer"
        : pathname.startsWith("/about")
          ? "About"
          : pathname.startsWith("/admin")
            ? "Admin"
            : "Markets";

  const navItems = isOperator
    ? [...NAV, { name: "Admin", href: "/admin" }]
    : NAV;

  const handleDeposit = async () => {
    if (!depositAmount || !appAddress) return;
    setDepositLoading(true);
    const id = toast("pending", "Depositing…", `${depositAmount} ETH`);
    try {
      const client = await getClient(appChain);
      const wc = await getWalletClient(appChain);
      if (!client || !wc) throw new Error("Could not get client");
      const [address] = await wc.requestAddresses();
      if (!address) throw new Error("No account");
      const value = parseEther(depositAmount);
      const txHash = await wc.depositEther({
        application: appAddress,
        value,
        account: address,
        chain: appChain,
        execLayerData: "0x",
      });
      await client.waitForTransactionReceipt({ hash: txHash });
      updateToast(id, "success", "Deposit confirmed");
      setDepositAmount("");
      setShowDeposit(false);
      await refreshUserInfo();
    } catch (err: any) {
      updateToast(id, "error", "Deposit failed", err.message);
    } finally {
      setDepositLoading(false);
    }
  };

  const navLink = (item: { name: string; href: string }, mobile = false) => (
    <Link
      key={item.name}
      href={item.href}
      onClick={() => setShowMobileNav(false)}
      className={
        mobile
          ? `py-2.5 px-1 text-[15px] font-medium no-underline border-b border-line2 ${
              activeName === item.name ? "text-ink" : "text-ink2"
            }`
          : `py-1.5 text-sm font-medium no-underline border-b-2 transition-colors ${
              activeName === item.name
                ? "text-ink border-ink"
                : "text-ink2 border-transparent hover:text-ink"
            }`
      }
    >
      {item.name}
    </Link>
  );

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-line bg-surface">
        <div className="max-w-[1500px] mx-auto px-4 md:px-7 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-8 min-w-0">
            <Link href="/" className="flex items-center gap-2.5 no-underline">
              <div className="w-[26px] h-[26px] rounded-[7px] bg-ink grid place-items-center text-accent font-mono text-sm font-bold">
                ◆
              </div>
              <span className="font-semibold text-base text-ink tracking-tight">
                cim
              </span>
            </Link>
            <nav className="hidden md:flex items-center gap-6">
              {navItems.map((item) => navLink(item))}
            </nav>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={() => setShowConfig((v) => !v)}
              title="Node settings"
              className="hidden sm:block p-2 rounded-full text-ink3 hover:text-ink hover:bg-line2 transition-colors"
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
              <div className="hidden lg:flex items-center gap-2 px-3.5 py-1.5 bg-line2 rounded-full text-[13px] text-ink2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="font-mono">{fmt.eth(userFreeFunds, 4)} ETH</span>
              </div>
            )}

            {appAddress && walletAddress && (
              <div className="hidden md:flex items-center gap-2">
                <button
                  onClick={() => setShowDeposit(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line text-[13px] font-medium text-ink2 hover:bg-line2 transition-colors"
                >
                  <Download size={13} /> Deposit
                </button>
                <button
                  onClick={() => setShowWithdraw(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line text-[13px] font-medium text-ink2 hover:bg-line2 transition-colors"
                >
                  <Upload size={13} /> Withdraw
                </button>
              </div>
            )}

            {walletAddress ? (
              <button
                onClick={disconnect}
                className="hidden md:flex items-center gap-2 bg-ink text-surface px-4 py-2 rounded-full text-[13px] font-medium hover:opacity-90 transition-opacity"
                title="Disconnect"
              >
                <span className="font-mono">{fmt.addr(walletAddress)}</span>
                <LogOut size={13} />
              </button>
            ) : (
              <button
                onClick={connect}
                className="bg-ink text-surface px-3.5 md:px-4 py-2 rounded-full text-[13px] font-medium hover:opacity-90 transition-opacity"
              >
                Connect<span className="hidden sm:inline"> Wallet</span>
              </button>
            )}

            <button
              onClick={() => setShowMobileNav((v) => !v)}
              className="md:hidden p-2 rounded-full text-ink2 hover:text-ink hover:bg-line2 transition-colors"
              aria-label="Menu"
            >
              {showMobileNav ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile slide-down menu */}
        {showMobileNav && (
          <div className="md:hidden border-t border-line bg-surface animate-in">
            <div className="px-4 py-3 flex flex-col">
              {navItems.map((item) => navLink(item, true))}
              {walletAddress && (
                <div className="flex items-center gap-2 pt-3 pb-1 flex-wrap">
                  {userFreeFunds !== undefined && (
                    <div className="flex items-center gap-2 px-3.5 py-1.5 bg-line2 rounded-full text-[13px] text-ink2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                      <span className="font-mono">
                        {fmt.eth(userFreeFunds, 4)} ETH
                      </span>
                    </div>
                  )}
                  {appAddress && (
                    <>
                      <button
                        onClick={() => {
                          setShowMobileNav(false);
                          setShowDeposit(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line text-[13px] font-medium text-ink2"
                      >
                        <Download size={13} /> Deposit
                      </button>
                      <button
                        onClick={() => {
                          setShowMobileNav(false);
                          setShowWithdraw(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line text-[13px] font-medium text-ink2"
                      >
                        <Upload size={13} /> Withdraw
                      </button>
                    </>
                  )}
                  <button
                    onClick={disconnect}
                    className="flex items-center gap-2 bg-ink text-surface px-3.5 py-1.5 rounded-full text-[13px] font-medium ml-auto"
                  >
                    <span className="font-mono">{fmt.addr(walletAddress)}</span>
                    <LogOut size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {showConfig && (
          <div className="border-t border-line bg-surface2">
            <div className="max-w-[1500px] mx-auto px-4 md:px-7 py-3 flex flex-wrap items-center gap-3">
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
        <Modal title="Deposit ETH" onClose={() => setShowDeposit(false)}>
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
            <button
              onClick={handleDeposit}
              disabled={depositLoading || !depositAmount}
              className="w-full bg-ink text-surface font-semibold py-3.5 rounded-xl text-sm disabled:opacity-50 transition-opacity hover:opacity-90"
            >
              {depositLoading ? "Depositing..." : "Deposit"}
            </button>
          </div>
        </Modal>
      )}

      {showWithdraw && <WithdrawModal onClose={() => setShowWithdraw(false)} />}
    </>
  );
}
