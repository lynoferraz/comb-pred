"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { VariableSummary, VariableInfo } from "../lib/cartesi";
import { getVarName, getStateName } from "../lib/cartesi";

const COLORS = ["bg-blue-600", "bg-slate-900", "bg-emerald-500", "bg-amber-500", "bg-violet-500"];

interface VariableCardProps {
  variable: VariableSummary;
  info?: VariableInfo | null;
}

export default function VariableCard({ variable, info }: VariableCardProps) {
  const { alias, states_probs, volume, volume_ss, n_operations } = variable;
  const displayName = getVarName(info, alias);
  const totalVolume = volume + volume_ss;

  return (
    <Link href={`/variable/${encodeURIComponent(alias)}`} className="no-underline text-inherit">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 cursor-pointer hover:border-blue-400 hover:shadow-xl hover:shadow-blue-500/5 transition-all group flex flex-col justify-between h-full">
        <div className="space-y-4">
          <div className="flex justify-between items-start">
            <div>
              {info?.category && (
                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-0.5 rounded-md mb-2 inline-block">
                  {info.category}
                </span>
              )}
              <h3 className="text-xl font-black text-slate-900 group-hover:text-blue-600 transition-colors">
                {displayName}
              </h3>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-black text-slate-400 uppercase">Total Volume</div>
              <div className="text-xs font-bold text-slate-900">{(totalVolume / 1e18).toFixed(4)} ETH</div>
            </div>
          </div>

          {info?.description && (
            <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{info.description}</p>
          )}

          <div className="grid grid-cols-2 gap-4 py-4 border-y border-slate-50">
            {states_probs.map((prob, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold">
                  <span className="text-slate-400 uppercase tracking-tighter">{getStateName(info, i)}</span>
                  <span className="text-slate-900">{(prob * 100).toFixed(0)}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${COLORS[i % COLORS.length]} transition-all duration-700`}
                    style={{ width: `${prob * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-4 text-[10px] font-bold text-slate-400">
            <span>Buy: {(volume / 1e18).toFixed(4)} ETH</span>
            <span>Short Sell: {(volume_ss / 1e18).toFixed(4)} ETH</span>
            <span>Ops: {n_operations}</span>
          </div>
          <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </Link>
  );
}
