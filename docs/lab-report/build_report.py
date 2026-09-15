"""生成实验报告：把回路统计、关键突触、验证、标定、Doom 统计嵌进 report.src.html → fruitfly-lab-report-v1.html。

用法（fruitfly-lab 目录下）：
    doom-play/.venv/bin/python docs/lab-report/build_report.py
"""
import json
from pathlib import Path

import numpy as np

D = Path(__file__).resolve().parent
ROOT = D.parents[1]

meta = json.loads((ROOT / "circuit/meta.json").read_text())
n, m = meta["n_neurons"], meta["n_edges"]
raw = (ROOT / "circuit/edges.bin").read_bytes()
off = np.frombuffer(raw, np.uint32, n + 1, 0)
post = np.frombuffer(raw, np.uint16, m, 4 * (n + 1))
w = np.frombuffer(raw, np.int16, m, 4 * (n + 1) + 2 * m)
pre = np.repeat(np.arange(n), np.diff(off).astype(np.int64))
G = {k: np.array(v) for k, v in meta["groups"].items()}

pairs = [("LC10a_L", "AOTU019_L"), ("LC10a_L", "AOTU025_L"), ("LC10a_R", "AOTU019_R"), ("LC10a_R", "AOTU025_R"),
         ("AOTU019_L", "DNa02_R"), ("AOTU019_R", "DNa02_L"), ("AOTU025_L", "DNa02_L"), ("AOTU025_R", "DNa02_R")]
keyw = {}
for a, b in pairs:
    mask = np.isin(pre, G[a]) & np.isin(post, G[b])
    keyw[f"{a}>{b}"] = int(w[mask].astype(np.int64).sum())

layers, types = {}, {}
for nn in meta["neurons"]:
    layers[str(nn["layer"])] = layers.get(str(nn["layer"]), 0) + 1
    types[nn["type"]] = types.get(nn["type"], 0) + 1

val = json.loads((ROOT / "output/validation.json").read_text())
ana = json.loads((ROOT / "doom/results/analysis.json").read_text())
keep = ["kills", "kills_sd", "kills_ci95", "survival_s", "accuracy", "shots", "p_vs_fly", "aim", "kills_list"]
data = {
    "circuit": {"n": n, "e": m, "inh_pct": round(100 * float((w < 0).mean()), 1), "layers": layers,
                "top_types": sorted(types.items(), key=lambda x: -x[1])[:10], "rule": meta["rule"]},
    "keyw": keyw,
    "validation": val,
    "calibration": {k: {"rows": v["rows"], "cal": v["cal"]} for k, v in ana["calibration"].items()},
    "doom": {k: {kk: v[kk] for kk in keep} for k, v in ana["conditions"].items()},
    "trace": ana["fly_trace_head"][:420],
    "live": [{"seed": 0, "fly": [7, 14.3], "scrambled_cal": [0, 6.5]}, {"seed": 687, "fly": [6, 12.5], "scrambled_cal": [2, 9.0]}],
}
src = (D / "report.src.html").read_text()
out = src.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
assert "/*DATA*/" not in out
(D / "fruitfly-lab-report-v1.html").write_text(out)
print(f"built {len(out):,} bytes; key weights: {keyw}")
