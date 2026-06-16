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
import GraphView from "../components/GraphView";
import { useToast } from "../components/ui/Toast";
import {
  Settings,
  Shield,
  Plus,
  CheckCircle,
  RefreshCw,
  UserCog,
  Share2,
} from "lucide-react";

const inputClass =
  "w-full bg-line2 border border-line rounded-xl px-4 py-3 text-sm outline-none focus:border-ink4";
const labelClass =
  "text-[11px] font-medium text-ink3 uppercase tracking-widest block mb-2";
const cardClass = "bg-surface border border-line rounded-card p-7 space-y-4";
const sectionTitle =
  "text-[11px] font-semibold text-ink3 uppercase tracking-widest";
const btnPrimary =
  "bg-ink text-surface font-semibold py-3 px-6 rounded-xl text-sm disabled:opacity-50 hover:opacity-90 transition-opacity";

export default function AdminPage() {
  const {
    config,
    appAddress,
    walletAddress,
    walletClient,
    aliases,
    marketData,
    infoMap,
    graphNodes,
    graphEdges,
    refresh,
  } = useApp();

  const [operatorAddr, setOperatorAddr] = useState("");
  const [adminAddr, setAdminAddr] = useState("");
  const [configData, setConfigData] = useState<Record<string, any> | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  const { toast, updateToast } = useToast();
  const [mutationLoading, setMutationLoading] = useState(false);

  const [bParam, setBParam] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [nStates, setNStates] = useState("2");
  const [cliquesInput, setCliquesInput] = useState("");
  const [newCluster, setNewCluster] = useState(true);
  const [newClusterAliases, setNewClusterAliases] = useState("");
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
        fetchOperatorAddr({}, { ...inspectOpts, decodeModel: "hex" }).catch(() => null),
        fetchAdminAddr({}, { ...inspectOpts, decodeModel: "hex" }).catch(() => null),
        fetchConfig({}, inspectOpts).catch(() => null),
      ]);
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
    const id = toast("pending", `${label}…`, "Waiting for the transaction");
    try {
      await fn();
      updateToast(id, "success", `${label} submitted`);
      fetchQueries();
      // Initialize/add/resolve all change the junction tree, so reload the
      // graph and market snapshot.
      refresh();
    } catch (err: any) {
      updateToast(id, "error", `${label} failed`, err.message);
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
    const split = (s: string) =>
      s.split(",").map((x) => x.trim()).filter(Boolean).map(strToBytes32);
    // "var2, var3; var4" -> [{aliases:[var2,var3]}, {aliases:[var4]}]
    const cliques = cliquesInput
      .split(";")
      .map((c) => split(c))
      .filter((c) => c.length > 0)
      .map((aliases) => ({ aliases }));
    runMutation("Add Variable", () =>
      addVariable(
        {
          alias: strToBytes32(newAlias),
          n_states: BigInt(parseInt(nStates)),
          resolve_address:
            resolveAddr ||
            operatorAddr ||
            "0x0000000000000000000000000000000000000000",
          cliques,
          new_cluster: newCluster,
          new_cluster_aliases: split(newClusterAliases),
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
      setOperatorAddress({ new_operator_address: newOperatorAddr } as any, mutationOpts),
    );
  };

  if (!walletAddress) {
    return (
      <div className="max-w-[700px] mx-auto py-24 px-7 text-center">
        <Shield size={40} className="text-ink3 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-ink">Admin Panel</h2>
        <p className="mt-2 text-ink3">
          Connect your wallet to access admin operations.
        </p>
      </div>
    );
  }

  if (walletAddress.toLowerCase() !== operatorAddr.toLowerCase()) {
    return (
      <div className="max-w-[700px] mx-auto py-24 px-7 text-center">
        <Shield size={40} className="text-ink3 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-ink">Admin Panel</h2>
        <p className="mt-2 text-ink3">
          Only the operator wallet can access admin operations.
        </p>
        <p className="mt-2 text-ink3 text-xs font-mono">Connected: {walletAddress}</p>
      </div>
    );
  }

  // Resolved variables are removed from the junction tree, so the graph's
  // unresolved alias list is exactly the set that can still be resolved.
  const unresolvedVars = aliases;

  return (
    <div className="px-4 md:px-7 pt-10 pb-14 max-w-[960px] mx-auto space-y-6 animate-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-ink">
            Admin
          </h1>
          <p className="text-sm text-ink2">
            Manage market configuration and variables.
          </p>
        </div>
        <button
          onClick={fetchQueries}
          disabled={queryLoading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-line text-xs font-medium text-ink2 hover:bg-line2 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={queryLoading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Junction tree graph */}
      {graphNodes.length > 0 && (
        <div className="bg-surface border border-line rounded-card overflow-hidden">
          <div className="px-7 py-5 border-b border-line flex items-center gap-2">
            <Share2 size={14} className="text-ink3" />
            <h3 className={sectionTitle}>Junction Tree</h3>
          </div>
          <div className="p-5">
            <GraphView nodes={graphNodes} edges={graphEdges} />
          </div>
        </div>
      )}

      {/* System info */}
      <div className="bg-surface border border-line rounded-card overflow-hidden">
        <div className="px-7 py-5 border-b border-line flex items-center gap-2">
          <Settings size={14} className="text-ink3" />
          <h3 className={sectionTitle}>System Info</h3>
        </div>
        <div className="divide-y divide-line">
          <Row label="Operator Address" value={operatorAddr || "-"} />
          <Row label="Admin Address" value={adminAddr || "-"} />
          {configData &&
            Object.entries(configData).map(([k, val]) => (
              <Row
                key={k}
                label={k}
                value={typeof val === "object" ? JSON.stringify(val) : String(val)}
              />
            ))}
        </div>
      </div>

      {/* Initialize AMM */}
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Settings size={14} className="text-ink3" />
          <h3 className={sectionTitle}>Initialize AMM</h3>
        </div>
        <div>
          <label className={labelClass}>b Parameter (ETH)</label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={bParam}
            onChange={(e) => setBParam(e.target.value)}
            placeholder="e.g. 0.00072"
            className={inputClass}
          />
        </div>
        <button onClick={handleInitialize} disabled={mutationLoading || !bParam} className={btnPrimary}>
          {mutationLoading ? "Submitting..." : "Initialize"}
        </button>
      </div>

      {/* Add variable */}
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Plus size={14} className="text-ink3" />
          <h3 className={sectionTitle}>Add Variable</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Alias</label>
            <input value={newAlias} onChange={(e) => setNewAlias(e.target.value)} placeholder="e.g. var1" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Number of States</label>
            <input type="number" min="2" max="8" value={nStates} onChange={(e) => setNStates(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Resolve Address</label>
          <input value={resolveAddr} onChange={(e) => setResolveAddr(e.target.value)} placeholder="0x... (defaults to operator)" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Join Cliques</label>
          <input value={cliquesInput} onChange={(e) => setCliquesInput(e.target.value)} placeholder="var2, var3; var4 (comma = same clique, semicolon = next clique)" className={inputClass} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>New Cluster</label>
            <label className="flex items-center gap-2 px-4 py-3 text-sm text-ink2">
              <input type="checkbox" checked={newCluster} onChange={(e) => setNewCluster(e.target.checked)} />
              Start a new clique for this variable
            </label>
          </div>
          <div>
            <label className={labelClass}>New Cluster Members</label>
            <input value={newClusterAliases} onChange={(e) => setNewClusterAliases(e.target.value)} placeholder="var5, var6 (existing vars joined into the new clique)" className={inputClass} disabled={!newCluster} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Info URL</label>
          <input value={infoUrl} onChange={(e) => setInfoUrl(e.target.value)} placeholder="https://..." className={inputClass} />
        </div>
        <button onClick={handleAddVariable} disabled={mutationLoading || !newAlias} className={btnPrimary}>
          {mutationLoading ? "Submitting..." : "Add Variable"}
        </button>
      </div>

      {/* Resolve variable */}
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <CheckCircle size={14} className="text-ink3" />
          <h3 className={sectionTitle}>Resolve Variable</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              {unresolvedVars.map((a) => (
                <option key={a} value={a}>
                  {getVarName(infoMap[a], a)}
                </option>
              ))}
            </select>
          </div>
          {resolveAlias && (
            <div>
              <label className={labelClass}>Final State</label>
              <select value={resolveState} onChange={(e) => setResolveState(e.target.value)} className={inputClass}>
                {(() => {
                  const n =
                    infoMap[resolveAlias]?.states?.length ??
                    marketData[resolveAlias]?.n_states ??
                    2;
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
        <button onClick={handleResolve} disabled={mutationLoading || !resolveAlias} className={btnPrimary}>
          {mutationLoading ? "Submitting..." : "Resolve"}
        </button>
      </div>

      {/* Set operator */}
      {walletAddress.toLowerCase() === adminAddr.toLowerCase() && adminAddr && (
        <div className={cardClass}>
          <div className="flex items-center gap-2">
            <UserCog size={14} className="text-ink3" />
            <h3 className={sectionTitle}>Set Operator Address</h3>
          </div>
          <p className="text-sm text-ink2">Only the admin address can change the operator.</p>
          <div>
            <label className={labelClass}>New Operator Address</label>
            <input value={newOperatorAddr} onChange={(e) => setNewOperatorAddr(e.target.value)} placeholder="0x..." className={inputClass} />
          </div>
          <button onClick={handleSetOperator} disabled={mutationLoading || !newOperatorAddr} className={btnPrimary}>
            {mutationLoading ? "Submitting..." : "Set Operator"}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-7 py-4 text-sm gap-4">
      <span className="text-ink3 font-medium">{label}</span>
      <span className="text-ink font-mono text-xs break-all text-right">{value}</span>
    </div>
  );
}
