"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TriangleAlert, X } from "lucide-react";

const STORAGE_KEY = "cim_disclaimer_dismissed";

// Thin banner under the header warning that this deployment is a test
// version: variables are resolved by the market operator, not by
// decentralized oracles. Dismissal is remembered per browser.
export default function DisclaimerBanner() {
  // Start hidden to avoid a hydration mismatch; show after reading storage.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "1") setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  };

  if (!visible) return null;

  return (
    <div className="border-b border-line bg-surface2">
      <div className="max-w-[1500px] mx-auto px-4 md:px-7 py-2 flex items-center gap-2.5 text-xs text-ink2">
        <TriangleAlert size={14} className="text-no shrink-0" />
        <span className="min-w-0">
          <span className="font-semibold text-ink">Test version.</span>{" "}
          Markets are resolved by the operator, not by decentralized oracles.
          Do not use real funds.{" "}
          <Link href="/about" className="underline hover:text-ink">
            Learn more
          </Link>
        </span>
        <button
          onClick={dismiss}
          className="ml-auto text-ink3 hover:text-ink transition-colors shrink-0"
          aria-label="Dismiss disclaimer"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
