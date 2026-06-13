"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { type Hex, numberToHex } from "viem";
import "viem/window";
import { envConfig } from "./config";
import { appChain } from "./chain";
import { useToast } from "../components/ui/Toast";
import {
  getAppAddress,
  getWalletClient,
} from "../backend-libs/cartesapp/utils";
import {
  graph as fetchGraphApi,
  variable as fetchVariableApi,
  operatorAddress as fetchOperatorAddr,
  userInfo as fetchUserInfoApi,
} from "../backend-libs/cim/lib";
import {
  type AppConfig,
  type VariableSummary,
  type VariableInfo,
  getInspectOptions,
} from "./cartesi";
import type { BaseLayerWalletClient } from "../backend-libs/cartesapp/utils";
import { useVariableInfoMap } from "./useVariableInfo";
import { fetchMarketSnapshot } from "./snapshot";

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
  aliases: string[];
  variables: VariableSummary[];
  graphNodes: string[][];
  graphEdges: [string[], string[]][];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  ensureVariables: (
    aliases: string[],
    opts?: { force?: boolean },
  ) => Promise<void>;
  config: AppConfig;
  operatorAddr: string | undefined;
  isOperator: boolean;
  infoMap: Record<string, VariableInfo | null>;
  ammB: number | undefined;
  userFreeFunds: number | undefined;
  userExpected: number | undefined;
  refreshUserInfo: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be inside AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const persisted = useRef(loadPersisted());
  const { toast } = useToast();

  const [nodeAddress, setNodeAddress] = useState(
    persisted.current?.nodeAddress || envConfig.nodeUrl,
  );
  const [appName, setAppName] = useState(
    persisted.current?.appName || envConfig.appName,
  );
  const [appAddress, setAppAddress] = useState<Hex | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [walletAddress, setWalletAddress] = useState<string | undefined>();
  const [walletClient, setWalletClient] =
    useState<BaseLayerWalletClient | null>(null);

  const [aliases, setAliases] = useState<string[]>([]);
  const [marketData, setMarketData] = useState<
    Record<string, VariableSummary>
  >({});
  // Ref mirror of marketData so ensureVariables can check "already loaded"
  // without depending on the state object (which would change its identity
  // on every batch and re-trigger consumers' effects).
  const marketDataRef = useRef<Record<string, VariableSummary>>({});
  const mergeMarketData = useCallback((batch: VariableSummary[]) => {
    for (const v of batch) marketDataRef.current[v.alias] = v;
    setMarketData((prev) => {
      const next = { ...prev };
      for (const v of batch) next[v.alias] = v;
      return next;
    });
  }, []);
  const [graphNodes, setGraphNodes] = useState<string[][]>([]);
  const [graphEdges, setGraphEdges] = useState<[string[], string[]][]>([]);
  const [operatorAddr, setOperatorAddr] = useState<string | undefined>();
  const [ammB, setAmmB] = useState<number | undefined>();
  const [userFreeFunds, setUserFreeFunds] = useState<number | undefined>();
  const [userExpected, setUserExpected] = useState<number | undefined>();
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
      const chainHex = numberToHex(appChain.id);
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainHex }],
      });
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
        params: [],
      })) as string[] | undefined;
      if (accounts && accounts.length > 0) {
        setWalletAddress(accounts[0]);
        setChainId(appChain.id);
        const wc = await getWalletClient(appChain);
        setWalletClient(wc);
      }
    } catch (err) {
      console.error("Connect failed:", err);
    }
  }, []);

  // User-initiated connect
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      toast(
        "error",
        "No wallet provider found",
        "Install a browser wallet (e.g. MetaMask) to connect.",
      );
      return;
    }
    await connectWallet();
  }, [connectWallet, toast]);

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

  // Fetch and cache variable info from /api/info/<alias>
  const infoMap = useVariableInfoMap(aliases);

  // Market data per alias, in junction-tree alias order. Entries appear
  // progressively as the snapshot batches resolve.
  const variables = useMemo(
    () =>
      aliases
        .map((a) => marketData[a])
        .filter((v): v is VariableSummary => v !== undefined),
    [aliases, marketData],
  );

  // Tier-2 authoritative read: the cim_variable inspect runs one
  // belief-propagation query inside the machine per alias, so it's only
  // used on demand — and never for an alias that already has data unless
  // `force` says it changed (events reflect current state, so re-querying
  // a loaded variable is wasted machine work). In-flight aliases are
  // skipped too, so overlapping calls can't duplicate queries.
  const ensureInFlight = useRef<Set<string>>(new Set());
  const ensureVariables = useCallback(
    async (targets: string[], opts?: { force?: boolean }) => {
      if (!appAddress || !nodeAddress) return;
      const todo = targets.filter(
        (a) =>
          !ensureInFlight.current.has(a) &&
          (opts?.force || marketDataRef.current[a] === undefined),
      );
      if (todo.length === 0) return;
      for (const a of todo) ensureInFlight.current.add(a);
      try {
        const CONCURRENCY = 4;
        for (let i = 0; i < todo.length; i += CONCURRENCY) {
          const slice = todo.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            slice.map(async (alias): Promise<VariableSummary | null> => {
              try {
                const report = await fetchVariableApi(
                  { alias },
                  {
                    ...getInspectOptions({ appAddress, nodeAddress }),
                    decode: true,
                    decodeModel: "json",
                  },
                );
                const data = report as Record<string, any>;
                // Resolved/unknown aliases come back as an empty object.
                if (!data || data.states_probs === undefined) return null;
                return {
                  alias,
                  states_probs: data.states_probs,
                  volume: data.volume,
                  volume_ss: data.volume_ss,
                  n_operations: data.n_operations ?? 0,
                  source: "query",
                };
              } catch {
                return null;
              }
            }),
          );
          const batch = results.filter(
            (v): v is VariableSummary => v !== null,
          );
          if (batch.length > 0) mergeMarketData(batch);
        }
      } finally {
        for (const a of todo) ensureInFlight.current.delete(a);
      }
    },
    [appAddress, nodeAddress, mergeMarketData],
  );

  // Cheap two-step load: one graph inspect for the junction tree (which
  // also yields the unresolved alias list — resolved variables are removed
  // from the tree), then the latest indexed ProbabilityUpdated notice per
  // alias. No belief-propagation inspects involved.
  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    if (!appAddress || !nodeAddress || refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    setError(null);
    try {
      const report = await fetchGraphApi(
        {},
        {
          ...getInspectOptions({ appAddress, nodeAddress }),
          decode: true,
          decodeModel: "json",
        },
      );
      const data = report as Record<string, any>;
      const nodes: string[][] = data.nodes ?? [];

      if (data.b !== undefined) setAmmB(Number(data.b) / 1e18);
      setGraphNodes(nodes);
      setGraphEdges(data.edges ?? []);

      // Clique members minus the `_x*` dummy-separator variables.
      const derived = Array.from(
        new Set(nodes.flat().filter((a) => !a.startsWith("_"))),
      ).sort();
      setAliases(derived);

      const received = new Set<string>();
      await fetchMarketSnapshot(
        derived,
        { appAddress, nodeAddress },
        (batch) => {
          for (const v of batch) received.add(v.alias);
          mergeMarketData(batch);
        },
      );

      // Aliases without an indexed event (emission can fail silently on
      // the backend) fall back to the authoritative inspect; force so a
      // stale entry from a previous refresh doesn't mask the gap.
      const missing = derived.filter((a) => !received.has(a));
      if (missing.length > 0) await ensureVariables(missing, { force: true });
    } catch (err: any) {
      setError(err.message || "Failed to load markets");
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, [appAddress, nodeAddress, ensureVariables]);

  useEffect(() => {
    if (appAddress) refresh();
  }, [appAddress, refresh]);

  // Fetch user balance (free funds + expected value) in ETH.
  const refreshUserInfo = useCallback(async () => {
    if (!appAddress || !nodeAddress || !walletAddress) return;
    try {
      const result = await fetchUserInfoApi(
        { user_address: walletAddress },
        {
          ...getInspectOptions({ appAddress, nodeAddress }),
          decode: true,
          decodeModel: "json",
        },
      );
      const data = result as { free_funds?: number; expected?: number };
      if (data?.free_funds !== undefined)
        setUserFreeFunds(Number(data.free_funds) / 1e18);
      if (data?.expected !== undefined)
        setUserExpected(Number(data.expected) / 1e18);
    } catch {}
  }, [appAddress, nodeAddress, walletAddress]);

  useEffect(() => {
    if (appAddress && walletAddress) refreshUserInfo();
    else {
      setUserFreeFunds(undefined);
      setUserExpected(undefined);
    }
  }, [appAddress, walletAddress, refreshUserInfo]);

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
        aliases,
        variables,
        graphNodes,
        graphEdges,
        loading,
        error,
        refresh,
        ensureVariables,
        config,
        operatorAddr,
        isOperator,
        infoMap,
        ammB,
        userFreeFunds,
        userExpected,
        refreshUserInfo,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
