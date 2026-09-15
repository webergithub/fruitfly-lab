"""把实验 1 的放电结果导出成 JSON（第 1 次试验、最活跃的 40 个神经元），给指南页面画放电栅格图。

用法（在 fruitfly-lab 目录下，先跑完 01）：
    Drosophila_brain_model/.venv/bin/python scripts/03_export_raster.py
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Drosophila_brain_model" / "results" / "lab" / "sugarR.parquet"
OUT = ROOT / "output" / "sugar_raster.json"
MN9 = 720575940660219265
TOP_N = 40

df = pd.read_parquet(SRC)
df["t"] = df["t"].astype(float)
n_trials = df["trial"].nunique()
rates = df.groupby("flywire_id").size() / n_trials  # 每次 1 秒，所以次数 = Hz
top = rates.sort_values(ascending=False).head(TOP_N).index.tolist()
if MN9 in rates.index and MN9 not in top:
    top[-1] = MN9

t0 = df[(df["trial"] == 0) & (df["flywire_id"].isin(top))]
rows = [
    {
        "id": str(fid),
        "hz": round(float(rates[fid]), 1),
        "mn9": fid == MN9,
        "t": [round(x * 1000, 1) for x in sorted(t0.loc[t0["flywire_id"] == fid, "t"])],
    }
    for fid in top
]
summary = {
    "trials": int(n_trials),
    "total_spikes": int(len(df)),
    "active_neurons": int(rates.size),
    "mn9_hz": round(float(rates.get(MN9, 0.0)), 1),
    "rows": rows,
}
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(summary, ensure_ascii=False))
print(f"导出 {len(rows)} 行 → {OUT}；MN9 = {summary['mn9_hz']} Hz；活跃神经元 {summary['active_neurons']}")
