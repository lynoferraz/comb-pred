"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { type Hex, numberToHex } from "viem";
import { anvil } from "viem/chains";
import "viem/window";
import {
  getAppAddress,
  getWalletClient,
} from "../backend-libs/cartesapp/utils";
import {
  summary as fetchSummaryApi,
  operatorAddress as fetchOperatorAddr,
} from "../backend-libs/cim/lib";
import {
  type AppConfig,
  type VariableSummary,
  type VariableInfo,
  getInspectOptions,
} from "./cartesi";
import type { BaseLayerWalletClient } from "../backend-libs/cartesapp/utils";
import { useVariableInfoMap } from "./useVariableInfo";

// --- localStorage persistence ---

const STORAGE_KEY = "cim_connection";

interface PersistedState {
  nodeAddress: string;
  appName: string;
  connected: boolean;
}

function loadPersisted(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePersisted(data: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function clearPersisted() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// --- Context ---

interface AppState {
  nodeAddress: string;
  setNodeAddress: (v: string) => void;
  appName: string;
  setAppName: (v: string) => void;
  appAddress: Hex | undefined;
  setAppAddress: (v: Hex) => void;
  chainId: number | undefined;
  walletAddress: string | undefined;
  walletClient: BaseLayerWalletClient | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  variables: VariableSummary[];
  graphNodes: string[][];
  graphEdges: [string[], string[]][];
  loading: boolean;
  error: string | null;
  fetchSummary: () => Promise<void>;
  config: AppConfig;
  operatorAddr: string | undefined;
  isOperator: boolean;
  infoMap: Record<string, VariableInfo | null>;
  ammB: number | undefined;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be inside AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const persisted = useRef(loadPersisted());

  const [nodeAddress, setNodeAddress] = useState(
    persisted.current?.nodeAddress || "http://localhost:8080",
  );
  const [appName, setAppName] = useState(persisted.current?.appName || "app");
  const [appAddress, setAppAddress] = useState<Hex | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [walletAddress, setWalletAddress] = useState<string | undefined>();
  const [walletClient, setWalletClient] =
    useState<BaseLayerWalletClient | null>(null);

  const [variables, setVariables] = useState<VariableSummary[]>([]);
  const [graphNodes, setGraphNodes] = useState<string[][]>([]);
  const [graphEdges, setGraphEdges] = useState<[string[], string[]][]>([]);
  const [operatorAddr, setOperatorAddr] = useState<string | undefined>();
  const [ammB, setAmmB] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve app address
  useEffect(() => {
    if (!appName || !nodeAddress) return;
    getAppAddress(appName, nodeAddress)
      .then((addr) => {
        if (addr) setAppAddress(addr);
      })
      .catch(() => {});
  }, [appName, nodeAddress]);

  // Core wallet connection logic (shared by connect + auto-reconnect)
  const connectWallet = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return;
    try {
      const chainHex = numberToHex(anvil.id);
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainHex }],
      });
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      if (accounts && accounts.length > 0) {
        setWalletAddress(accounts[0]);
        setChainId(anvil.id);
        const wc = await getWalletClient(anvil);
        setWalletClient(wc);
      }
    } catch (err) {
      console.error("Connect failed:", err);
    }
  }, []);

  // User-initiated connect
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert("No wallet provider found");
      return;
    }
    await connectWallet();
  }, [connectWallet]);

  // Disconnect
  const disconnect = useCallback(() => {
    setWalletAddress(undefined);
    setWalletClient(null);
    setChainId(undefined);
    clearPersisted();
  }, []);

  // Persist state whenever wallet connects or settings change
  useEffect(() => {
    if (walletAddress) {
      savePersisted({ nodeAddress, appName, connected: true });
    }
  }, [walletAddress, nodeAddress, appName]);

  // Auto-reconnect on mount if previously connected
  useEffect(() => {
    if (
      persisted.current?.connected &&
      !walletAddress &&
      typeof window !== "undefined" &&
      window.ethereum
    ) {
      connectWallet();
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch operator address
  useEffect(() => {
    if (!appAddress || !nodeAddress) return;
    fetchOperatorAddr(
      {},
      {
        ...getInspectOptions({ appAddress, nodeAddress }),
        decode: true,
        decodeModel: "json",
      },
    )
      .then((result) => {
        if (typeof result === "string") setOperatorAddr(result.toLowerCase());
        else if (result?.address) setOperatorAddr(result.address.toLowerCase());
      })
      .catch(() => {});
  }, [appAddress, nodeAddress]);

  const isOperator =
    !!walletAddress &&
    !!operatorAddr &&
    walletAddress.toLowerCase() === operatorAddr;

  // Fetch and cache variable info from info_urls
  const infoMap = useVariableInfoMap(variables);

  // Fetch summary
  const fetchSummary = useCallback(async () => {
    if (!appAddress || !nodeAddress) return;
    setLoading(true);
    setError(null);
    try {
      const report = await fetchSummaryApi(
        {},
        {
          ...getInspectOptions({ appAddress, nodeAddress }),
          decode: true,
          decodeModel: "json",
        },
      );
      const data = report as Record<string, any>;
      const vars: VariableSummary[] = [];

      if (data.b !== undefined) setAmmB(Number(data.b));

      for (const [alias, info] of Object.entries(data)) {
        if (alias === "nodes" || alias === "edges" || alias === "b") continue;
        vars.push({
          alias,
          states_probs: info.states_probs,
          volume: info.volume,
          volume_ss: info.volume_ss,
          n_operations: info.n_operations ?? 0,
          info_url: info.info_url,
        });
      }

      setVariables(vars);
      if (data.nodes) setGraphNodes(data.nodes);
      if (data.edges) setGraphEdges(data.edges);
    } catch (err: any) {
      setError(err.message || "Failed to load summary");
    } finally {
      setLoading(false);
    }
  }, [appAddress, nodeAddress]);

  useEffect(() => {
    if (appAddress) fetchSummary();
  }, [appAddress, fetchSummary]);

  const config: AppConfig = {
    appAddress: appAddress || ("0x" as Hex),
    nodeAddress,
    chainId,
  };

  return (
    <AppContext.Provider
      value={{
        nodeAddress,
        setNodeAddress,
        appName,
        setAppName,
        appAddress,
        setAppAddress,
        chainId,
        walletAddress,
        walletClient,
        connect,
        disconnect,
        variables,
        graphNodes,
        graphEdges,
        loading,
        error,
        fetchSummary,
        config,
        operatorAddr,
        isOperator,
        infoMap,
        ammB,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
