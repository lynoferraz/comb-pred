"use client";

import { useState, useEffect, useCallback } from "react";
import { useApp } from "../lib/context";
import { getInspectOptions, getVarName, getStateName } from "../lib/cartesi";
import {
  operatorAddress as fetchOperatorAddr,
  adminAddress as fetchAdminAddr,
  config as fetchConfig,
  initializeAmm,
  addVariable,
  resolveVariable,
  setOperatorAddress,
} from "../backend-libs/cim/lib";
import {
  Settings,
  Shield,
  Plus,
  CheckCircle,
  RefreshCw,
  UserCog,
} from "lucide-react";

export default function AdminPage() {
  const {
    config,
    appAddress,
    walletAddress,
    walletClient,
    variables,
    infoMap,
  } = useApp();

  const [operatorAddr, setOperatorAddr] = useState<string>("");
  const [adminAddr, setAdminAddr] = useState<string>("");
  const [configData, setConfigData] = useState<Record<string, any> | null>(
    null,
  );
  const [queryLoading, setQueryLoading] = useState(false);

  const [mutationLoading, setMutationLoading] = useState(false);
  const [mutationResult, setMutationResult] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const [bParam, setBParam] = useState("");

  const [newAlias, setNewAlias] = useState("");
  const [nStates, setNStates] = useState("2");
  const [relatedAliases, setRelatedAliases] = useState("");
  const [relatedAliases2, setRelatedAliases2] = useState("");
  const [relatedAliases3, setRelatedAliases3] = useState("");
  const [resolveAddr, setResolveAddr] = useState("");
  const [infoUrl, setInfoUrl] = useState("");

  const [resolveAlias, setResolveAlias] = useState("");
  const [resolveState, setResolveState] = useState("0");

  const [newOperatorAddr, setNewOperatorAddr] = useState("");

  const inspectOpts = {
    ...getInspectOptions(config),
    decode: true,
    decodeModel: "json",
  };

  const fetchQueries = useCallback(async () => {
    if (!appAddress) return;
    setQueryLoading(true);
    try {
      const [opResult, adResult, cfgResult] = await Promise.all([
        fetchOperatorAddr({}, { ...inspectOpts, decodeModel: "hex" }).catch(
          () => null,
        ),
        fetchAdminAddr({}, { ...inspectOpts, decodeModel: "hex" }).catch(
          () => null,
        ),
        fetchConfig({}, inspectOpts).catch(() => null),
      ]);
      console.log("fetchQueries results", opResult, adResult, cfgResult);
      if (typeof opResult === "string") setOperatorAddr(opResult);
      if (typeof adResult === "string") setAdminAddr(adResult);
      if (cfgResult) setConfigData(cfgResult);
    } catch {}
    setQueryLoading(false);
  }, [appAddress, config]);

  useEffect(() => {
    if (appAddress) fetchQueries();
  }, [appAddress, fetchQueries]);

  const strToBytes32 = (s: string): string => {
    const hex = Array.from(new TextEncoder().encode(s))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return "0x" + hex.padEnd(64, "0");
  };

  const runMutation = async (label: string, fn: () => Promise<any>) => {
    setMutationLoading(true);
    setMutationResult(null);
    setMutationError(null);
    try {
      await fn();
      setMutationResult(`${label} submitted successfully`);
      fetchQueries();
    } catch (err: any) {
      setMutationError(err.message || `${label} failed`);
    } finally {
      setMutationLoading(false);
    }
  };

  const mutationOpts = {
    applicationAddress: appAddress!,
    client: walletClient!,
  };

  const handleInitialize = () => {
    if (!bParam) return;
    runMutation("Initialize AMM", () =>
      initializeAmm(
        { b: BigInt(Math.round(parseFloat(bParam) * 1e18)) } as any,
        mutationOpts,
      ),
    );
  };

  const handleAddVariable = () => {
    if (!newAlias || !nStates) return;
    const related = relatedAliases
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(strToBytes32);
    const related2 = relatedAliases2
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(strToBytes32);
    const related3 = relatedAliases3
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(strToBytes32);
    runMutation("Add Variable", () =>
      addVariable(
        {
          alias: strToBytes32(newAlias),
          n_states: BigInt(parseInt(nStates)),
          resolve_address:
            resolveAddr ||
            operatorAddr ||
            "0x0000000000000000000000000000000000000000",
          related_aliases: related,
          related_aliases2: related2,
          related_aliases3: related3,
          info_url: infoUrl,
        } as any,
        mutationOpts,
      ),
    );
  };

  const handleResolve = () => {
    if (!resolveAlias) return;
    runMutation("Resolve Variable", () =>
      resolveVariable(
        {
          alias: strToBytes32(resolveAlias),
          state: BigInt(parseInt(resolveState)),
        } as any,
        mutationOpts,
      ),
    );
  };

  const handleSetOperator = () => {
    if (!newOperatorAddr) return;
    runMutation("Set Operator Address", () =>
      setOperatorAddress(
        { new_operator_address: newOperatorAddr } as any,
        mutationOpts,
      ),
    );
  };

  if (!walletAddress) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-300">
          <Shield size={40} />
        </div>
        <h2 className="text-xl font-black text-slate-900">Admin Panel</h2>
        <p className="text-slate-400 max-w-xs font-medium">
          Connect your wallet to access admin operations.
        </p>
      </div>
    );
  }

  if (walletAddress.toLowerCase() !== operatorAddr.toLowerCase()) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-300">
          <Shield size={40} />
        </div>
        <h2 className="text-xl font-black text-slate-900">Admin Panel</h2>
        <p className="text-slate-400 max-w-xs font-medium">
          Only the operator wallet can access admin operations.
        </p>
        <p className="text-slate-400 text-xs font-mono">
          Connected: {walletAddress}
        </p>
      </div>
    );
  }

  const unresolvedVars = variables.filter(
    (v) => v.states_probs.length > 0 && !v.states_probs.some((p) => p === 1),
  );

  const inputClass =
    "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 ring-blue-500/10 outline-none";
  const labelClass =
    "text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2";
  const btnPrimaryClass =
    "bg-slate-900 hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed text-white font-black py-3 px-6 rounded-2xl text-xs transition-all";

  return (
    <div className="max-w-4xl space-y-8 animate-in">
      {/* Title */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            Admin Panel
          </h2>
          <p className="text-sm text-slate-500 font-medium">
            Manage market configuration and variables.
          </p>
        </div>
        <button
          onClick={fetchQueries}
          disabled={queryLoading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={queryLoading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Feedback */}
      {mutationResult && (
        <div className="text-emerald-600 text-xs font-bold bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          {mutationResult}
        </div>
      )}
      {mutationError && (
        <div className="text-red-500 text-xs font-bold bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {mutationError}
        </div>
      )}

      {/* System Info */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
          <Settings size={14} className="text-slate-400" />
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
            System Info
          </h3>
        </div>
        <div className="divide-y divide-slate-100">
          <div className="flex justify-between px-8 py-4 text-sm">
            <span className="text-slate-400 font-bold">Operator Address</span>
            <span className="text-slate-900 font-mono text-xs">
              {operatorAddr || "-"}
            </span>
          </div>
          <div className="flex justify-between px-8 py-4 text-sm">
            <span className="text-slate-400 font-bold">Admin Address</span>
            <span className="text-slate-900 font-mono text-xs">
              {adminAddr || "-"}
            </span>
          </div>
          {configData &&
            Object.entries(configData).map(([key, val]) => (
              <div key={key} className="flex justify-between px-8 py-4 text-sm">
                <span className="text-slate-400 font-bold">{key}</span>
                <span className="text-slate-900 font-mono text-xs">
                  {typeof val === "object" ? JSON.stringify(val) : String(val)}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Initialize AMM */}
      <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Settings size={14} className="text-slate-400" />
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
            Initialize AMM
          </h3>
        </div>
        <div>
          <label className={labelClass}>b Parameter (ETH)</label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={bParam}
            onChange={(e) => setBParam(e.target.value)}
            placeholder="e.g. 0.072"
            className={inputClass}
          />
        </div>
        <button
          onClick={handleInitialize}
          disabled={mutationLoading || !bParam}
          className={btnPrimaryClass}
        >
          {mutationLoading ? "Submitting..." : "Initialize"}
        </button>
      </div>

      {/* Add Variable */}
      <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Plus size={14} className="text-slate-400" />
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
            Add Variable
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Alias</label>
            <input
              type="text"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              placeholder="e.g. var1"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Number of States</label>
            <input
              type="number"
              min="2"
              max="8"
              value={nStates}
              onChange={(e) => setNStates(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Resolve Address</label>
          <input
            type="text"
            value={resolveAddr}
            onChange={(e) => setResolveAddr(e.target.value)}
            placeholder="0x... (defaults to operator address)"
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>
              Related Aliases (comma-separated)
            </label>
            <input
              type="text"
              value={relatedAliases}
              onChange={(e) => setRelatedAliases(e.target.value)}
              placeholder="e.g. var2, var3"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              Related Aliases 2 (comma-separated)
            </label>
            <input
              type="text"
              value={relatedAliases2}
              onChange={(e) => setRelatedAliases2(e.target.value)}
              placeholder="e.g. var4, var5"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              Related Aliases 3 (comma-separated)
            </label>
            <input
              type="text"
              value={relatedAliases3}
              onChange={(e) => setRelatedAliases3(e.target.value)}
              placeholder="e.g. var6, var7"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Info URL</label>
          <input
            type="text"
            value={infoUrl}
            onChange={(e) => setInfoUrl(e.target.value)}
            placeholder="https://..."
            className={inputClass}
          />
        </div>
        <button
          onClick={handleAddVariable}
          disabled={mutationLoading || !newAlias}
          className={btnPrimaryClass}
        >
          {mutationLoading ? "Submitting..." : "Add Variable"}
        </button>
      </div>

      {/* Resolve Variable */}
      <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle size={14} className="text-slate-400" />
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
            Resolve Variable
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Variable</label>
            <select
              value={resolveAlias}
              onChange={(e) => {
                setResolveAlias(e.target.value);
                setResolveState("0");
              }}
              className={inputClass}
            >
              <option value="">Select...</option>
              {unresolvedVars.map((v) => (
                <option key={v.alias} value={v.alias}>
                  {getVarName(infoMap[v.alias], v.alias)}
                </option>
              ))}
            </select>
          </div>
          {resolveAlias && (
            <div>
              <label className={labelClass}>Final State</label>
              <select
                value={resolveState}
                onChange={(e) => setResolveState(e.target.value)}
                className={inputClass}
              >
                {(() => {
                  const v = variables.find((v) => v.alias === resolveAlias);
                  const n = v ? v.states_probs.length : 2;
                  return Array.from({ length: n }, (_, i) => (
                    <option key={i} value={i}>
                      {getStateName(infoMap[resolveAlias], i)}
                    </option>
                  ));
                })()}
              </select>
            </div>
          )}
        </div>
        <button
          onClick={handleResolve}
          disabled={mutationLoading || !resolveAlias}
          className={btnPrimaryClass}
        >
          {mutationLoading ? "Submitting..." : "Resolve"}
        </button>
      </div>

      {/* Set Operator Address */}
      {walletAddress.toLowerCase() === adminAddr.toLowerCase() && adminAddr && (
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <UserCog size={14} className="text-slate-400" />
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
              Set Operator Address
            </h3>
          </div>
          <p className="text-sm text-slate-500">
            Only the admin address can change the operator.
          </p>
          <div>
            <label className={labelClass}>New Operator Address</label>
            <input
              type="text"
              value={newOperatorAddr}
              onChange={(e) => setNewOperatorAddr(e.target.value)}
              placeholder="0x..."
              className={inputClass}
            />
          </div>
          <button
            onClick={handleSetOperator}
            disabled={mutationLoading || !newOperatorAddr}
            className={btnPrimaryClass}
          >
            {mutationLoading ? "Submitting..." : "Set Operator"}
          </button>
        </div>
      )}
    </div>
  );
}
