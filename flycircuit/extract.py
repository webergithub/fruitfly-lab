"""从 FlyWire v783 全脑连接组里抽出「视觉追踪 → 转向」回路子图，导出给网页和 Doom 实验共用。

回路依据：LC10a（小物体检测）→ AOTU019（GABA，投射对侧）/ AOTU025（ACh，投射同侧）→ DNa02 等转向下行神经元
（Specialized parallel pathways for adaptive control of visual object pursuit, Neuron 2026）。

选点规则：突触数 ≥ THR 的边上，从 LC10a 向下游走 ≤ DEPTH 步、从转向 DN 向上游走 ≤ DEPTH 步，两者交集
+ 起点 + 终点；子图内部保留所有强度的边。
用法（fruitfly-lab 目录下）：
    Drosophila_brain_model/.venv/bin/python flycircuit/extract.py
输出：circuit/meta.json + circuit/edges.bin（CSR：offsets u32 | post u16 | weight i16）
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "circuit"
THR, DEPTH = 5, 2
SOURCE = ["LC10a"]
STEER = ["DNa01", "DNa02", "DNa03", "DNa04", "DNa11"]
W_SYN_MV = 0.275  # Shiu et al. 2024 每个突触的权重

ann = pd.read_csv(ROOT / "data/flywire_annotations_783.tsv", sep="\t", low_memory=False,
                  usecols=["root_id", "cell_type", "hemibrain_type", "side", "super_class", "cell_class",
                           "top_nt", "soma_x", "soma_y", "soma_z", "pos_x", "pos_y", "pos_z"])
con = pd.read_parquet(ROOT / "Drosophila_brain_model/Connectivity_783.parquet",
                      columns=["Presynaptic_ID", "Postsynaptic_ID", "Connectivity", "Excitatory x Connectivity"])

S = set(ann.root_id[ann.cell_type.isin(SOURCE)])
T = set(ann.root_id[ann.cell_type.isin(STEER)])
strong = con[con.Connectivity >= THR]


def bfs(start, src_col, dst_col):
    seen, frontier, dist = set(start), set(start), {n: 0 for n in start}
    for d in range(1, DEPTH + 1):
        frontier = set(strong[dst_col][strong[src_col].isin(frontier)]) - seen
        seen |= frontier
        dist.update({n: d for n in frontier})
    return seen, dist


fwd, dist_fwd = bfs(S, "Presynaptic_ID", "Postsynaptic_ID")
bwd, _ = bfs(T, "Postsynaptic_ID", "Presynaptic_ID")
nodes = (fwd & bwd) | S | T

a = ann.set_index("root_id").reindex(sorted(nodes))
a["cell_type"] = a.cell_type.fillna(a.hemibrain_type).fillna("unknown")
a["layer"] = [dist_fwd.get(i, DEPTH + 1) for i in a.index]
a.loc[a.index.isin(T), "layer"] = DEPTH + 1  # 转向 DN 统一放最后一层
a["side"] = a.side.fillna("center")
a = a.sort_values(["layer", "cell_type", "side"])
ids = a.index.to_numpy()
idx = {n: i for i, n in enumerate(ids)}

e = con[con.Presynaptic_ID.isin(nodes) & con.Postsynaptic_ID.isin(nodes)].copy()
e["pre"] = e.Presynaptic_ID.map(idx)
e["post"] = e.Postsynaptic_ID.map(idx)
e = e.sort_values(["pre", "post"])
offsets = np.zeros(len(ids) + 1, dtype=np.uint32)
np.add.at(offsets, e.pre.to_numpy() + 1, 1)
offsets = np.cumsum(offsets).astype(np.uint32)

# LC10a 视野位置代理：更多连到 AOTU019（中央视野 0–40°）→ 偏中央；更多连到 AOTU025（外周 40–90°）→ 偏外周
lc = a.index[a.cell_type == "LC10a"]
aotu = {(t, s): ann.root_id[(ann.cell_type == t) & (ann.side == s)].tolist() for t in ["AOTU019", "AOTU025"] for s in ["left", "right"]}
central = {}
for n in lc:
    s = a.at[n, "side"]
    out = con[con.Presynaptic_ID == n]
    w19 = out.Connectivity[out.Postsynaptic_ID.isin(aotu[("AOTU019", s)])].sum()
    w25 = out.Connectivity[out.Postsynaptic_ID.isin(aotu[("AOTU025", s)])].sum()
    central[n] = float(w19 / (w19 + w25)) if w19 + w25 > 0 else 0.5

# 坐标：FlyWire 体素 4×4×40 nm → μm；优先胞体位置
x = a.soma_x.fillna(a.pos_x) * 4e-3
y = a.soma_y.fillna(a.pos_y) * 4e-3
z = a.soma_z.fillna(a.pos_z) * 40e-3

neurons = [
    {"id": str(n), "type": r.cell_type, "side": r.side, "cls": r.super_class if isinstance(r.super_class, str) else "",
     "nt": r.top_nt if isinstance(r.top_nt, str) else "", "layer": int(r.layer),
     "x": round(float(x[n]), 1), "y": round(float(y[n]), 1), "z": round(float(z[n]), 1),
     **({"central": round(central[n], 3)} if n in central else {})}
    for n, r in a.iterrows()
]


def group(t, s):
    return [i for i, nn in enumerate(neurons) if nn["type"] == t and nn["side"] == s]


groups = {f"{t}_{s[0].upper()}": group(t, s) for t in SOURCE + ["LC10d", "AOTU019", "AOTU025"] + STEER for s in ["left", "right"]}
meta = {
    "source": "FlyWire FAFB v783 (Dorkenwald et al. 2024; Schlegel et al. 2024 annotations)",
    "rule": f"synapses>={THR}, depth<={DEPTH}, LC10a -> steering DNs",
    "n_neurons": len(ids), "n_edges": int(len(e)),
    "w_syn_mv": W_SYN_MV,
    "params": {"v0": -52, "v_rst": -52, "v_th": -45, "t_mbr_ms": 20, "tau_ms": 5, "t_rfc_ms": 2.2, "t_dly_ms": 1.8,
               "poisson_kick_mv": W_SYN_MV * 250},
    "groups": {k: v for k, v in groups.items() if v},
    "layers": sorted({nn["layer"] for nn in neurons}),
    "neurons": neurons,
}
OUT.mkdir(exist_ok=True)
(OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
w = e["Excitatory x Connectivity"].clip(-32768, 32767).to_numpy(np.int16)
with open(OUT / "edges.bin", "wb") as f:
    f.write(offsets.tobytes())
    f.write(e.post.to_numpy(np.uint16).tobytes())
    f.write(w.tobytes())

print(f"子图：{len(ids)} 个神经元，{len(e):,} 条连接，{(e['Excitatory x Connectivity'] < 0).mean():.0%} 抑制性")
print("各层神经元数：", a.groupby("layer").size().to_dict())
print("关键组：", {k: len(v) for k, v in meta["groups"].items()})
print("最常见细胞类型：", a.cell_type.value_counts().head(12).to_dict())
