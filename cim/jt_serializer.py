"""
Serialize / deserialize pgmpy JunctionTree objects and asset-block dicts
using numpy.memmap.

Layout on disk:
  amm_meta.json          – all structural metadata
  bp_values.dat          – memmap for main JT factor values
  user_<id>_jt_values.dat    – memmap per user JT
  user_<id>_ab_values.dat    – memmap per user asset-block dict
"""
import json
import os

import numpy as np
from pgmpy.factors.discrete import DiscreteFactor
from pgmpy.models import JunctionTree


# ---------------------------------------------------------------------------
# Single JunctionTree  →  (metadata dict, flat float64 array)
# ---------------------------------------------------------------------------

def jt_to_raw(jt: JunctionTree) -> tuple[dict, np.ndarray]:
    """Return (metadata_dict, flat_values) for a JunctionTree."""
    factors_meta = []
    value_chunks: list[np.ndarray] = []
    offset = 0

    for f in jt.get_factors():
        flat = f.values.astype(np.float64).ravel()
        factors_meta.append({
            "variables": list(f.variables),
            "cardinality": [int(c) for c in f.cardinality],
            "offset": offset,
            "size": flat.size,
        })
        value_chunks.append(flat)
        offset += flat.size

    values = np.concatenate(value_chunks) if value_chunks else np.array([], dtype=np.float64)

    meta = {
        "nodes": [list(n) for n in jt.nodes()],
        "edges": [[list(a), list(b)] for a, b in jt.edges()],
        "factors": factors_meta,
    }
    return meta, values


def raw_to_jt(meta: dict, values: np.ndarray) -> JunctionTree:
    """Reconstruct a JunctionTree from metadata + flat values array."""
    jt = JunctionTree()

    edges = [tuple(tuple(n) for n in e) for e in meta["edges"]]
    if edges:
        jt.add_edges_from(edges)
    else:
        for node in meta["nodes"]:
            jt.add_node(tuple(node))

    factors = []
    for fm in meta["factors"]:
        vals = values[fm["offset"]:fm["offset"] + fm["size"]].copy()
        factors.append(DiscreteFactor(fm["variables"], fm["cardinality"], vals))

    if factors:
        jt.add_factors(*factors)

    return jt


# ---------------------------------------------------------------------------
# Asset-block dict  →  (metadata list, flat float64 array)
# A block dict is  dict[tuple[str,...], DiscreteFactor]
# ---------------------------------------------------------------------------

def blocks_to_raw(blocks: dict) -> tuple[list[dict], np.ndarray]:
    """Return (factors_meta_list, flat_values) for an asset-block dict."""
    factors_meta = []
    value_chunks: list[np.ndarray] = []
    offset = 0

    for key, f in blocks.items():
        flat = f.values.astype(np.float64).ravel()
        factors_meta.append({
            "key": list(key),
            "variables": list(f.variables),
            "cardinality": [int(c) for c in f.cardinality],
            "offset": offset,
            "size": flat.size,
        })
        value_chunks.append(flat)
        offset += flat.size

    values = np.concatenate(value_chunks) if value_chunks else np.array([], dtype=np.float64)
    return factors_meta, values


def raw_to_blocks(factors_meta: list[dict], values: np.ndarray) -> dict:
    """Reconstruct an asset-block dict from metadata + flat values."""
    blocks = {}
    for fm in factors_meta:
        vals = values[fm["offset"]:fm["offset"] + fm["size"]].copy()
        key = tuple(fm["key"])
        blocks[key] = DiscreteFactor(fm["variables"], fm["cardinality"], vals)
    return blocks


# ---------------------------------------------------------------------------
# Write / read a single memmap values file
# ---------------------------------------------------------------------------

def _write_memmap(path: str, arr: np.ndarray) -> None:
    fp = np.memmap(path, dtype=np.float64, mode="w+", shape=arr.shape)
    fp[:] = arr[:]
    fp.flush()
    del fp


def _read_memmap(path: str, size: int) -> np.ndarray:
    if size == 0:
        return np.array([], dtype=np.float64)
    return np.memmap(path, dtype=np.float64, mode="r", shape=(size,))


# ---------------------------------------------------------------------------
# Full AMM state  →  disk
# ---------------------------------------------------------------------------

def save_amm_state(directory: str, amm) -> None:
    """Persist the serializable parts of a ABAmm to *directory*.

    Files created:
        amm_meta.json
        bp_values.dat                (main JT factor values)
        user_<id>_jt_values.dat      (one per user JT)
        user_<id>_ab_values.dat      (one per user asset-block dict)
    """
    os.makedirs(directory, exist_ok=True)

    meta: dict = {
        "initialized": amm._initialized,
        "b": float(amm._b) if amm._initialized else 0.0,
    }

    if amm._initialized:
        bp_meta, bp_vals = jt_to_raw(amm._bp.junction_tree)
        meta["bp"] = bp_meta
        _write_memmap(os.path.join(directory, "bp_values.dat"), bp_vals)

        # User asset blocks
        users_ab_meta = {}
        for uid, ab_dict in amm._user_asset_blocks.items():
            safe_name = uid.replace("/", "_")
            fname = f"user_{safe_name}_ab_values.dat"
            ab_factors_meta, ab_vals = blocks_to_raw(ab_dict)
            users_ab_meta[uid] = {"file": fname, "blocks": ab_factors_meta}
            if ab_vals.size > 0:
                _write_memmap(os.path.join(directory, fname), ab_vals)
        meta["user_asset_blocks"] = users_ab_meta

    with open(os.path.join(directory, "amm_meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))


def load_amm_state(directory: str, amm) -> None:
    """Restore a ABAmm from files written by *save_amm_state*.

    Mutates *amm* in place; does NOT touch the wallet callback hooks.
    """
    from pgmpy.inference import BeliefPropagation

    meta_path = os.path.join(directory, "amm_meta.json")
    if not os.path.exists(meta_path):
        return

    with open(meta_path) as f:
        meta = json.load(f)

    amm._initialized = meta["initialized"]

    if not amm._initialized:
        return

    amm._b = meta["b"]

    # Main JT  →  BeliefPropagation
    bp_meta = meta["bp"]
    total_bp = sum(fm["size"] for fm in bp_meta["factors"])
    bp_vals = _read_memmap(os.path.join(directory, "bp_values.dat"), total_bp)
    main_jt = raw_to_jt(bp_meta, bp_vals)
    amm._bp = BeliefPropagation(main_jt)
    amm._bp.calibrate()

    # User JTs
    amm._user_jts = {}
    for uid, u_meta in meta.get("user_jts", {}).items():
        total_u = sum(fm["size"] for fm in u_meta["factors"])
        u_vals = _read_memmap(os.path.join(directory, u_meta["file"]), total_u)
        amm._user_jts[uid] = raw_to_jt(u_meta, u_vals)

    # User asset blocks
    amm._user_asset_blocks = {}
    for uid, ab_meta in meta.get("user_asset_blocks", {}).items():
        blocks_meta = ab_meta["blocks"]
        if blocks_meta:
            total_ab = sum(fm["size"] for fm in blocks_meta)
            ab_vals = _read_memmap(os.path.join(directory, ab_meta["file"]), total_ab)
        else:
            ab_vals = np.array([], dtype=np.float64)
        amm._user_asset_blocks[uid] = raw_to_blocks(blocks_meta, ab_vals)
