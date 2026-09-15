"""验证抽出的子图：单侧刺激 LC10a，转向神经元 DNa02 的左右差是否与全脑模型一致；并跑打乱接线对照。

条件：左眼 LC10a @100Hz / 右眼 LC10a @100Hz；每个条件 5 次 × 1 秒。
A. 子图 LIF（numpy，flycircuit/lif.py）   B. 子图打乱接线对照   C. 全脑 Brian2（Shiu 模型 + v783，13.9 万神经元）
用法（fruitfly-lab 目录下）：
    Drosophila_brain_model/.venv/bin/python flycircuit/validate.py
输出：output/validation.json
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "flycircuit"))
sys.path.insert(0, str(ROOT / "Drosophila_brain_model"))
from lif import LIF, Circuit  # noqa: E402

RATE, N_RUN, STEPS = 100.0, 5, 10_000  # 100 Hz, 5 次, 1 s
READ = ["LC10a_L", "LC10a_R", "AOTU019_L", "AOTU019_R", "AOTU025_L", "AOTU025_R",
        "DNa02_L", "DNa02_R", "DNa01_L", "DNa01_R", "DNa03_L", "DNa03_R", "DNa11_L", "DNa11_R"]
circ = Circuit()
ids = [nn["id"] for nn in circ.meta["neurons"]]


def run_sub(c, stim_group):
    out = {k: [] for k in READ}
    rates = np.zeros(c.n)
    rates[circ.groups[stim_group]] = RATE
    for r in range(N_RUN):
        cnt = LIF(c, seed=r).run(STEPS, rates)
        for k in READ:
            out[k].append(float(cnt[circ.groups[k]].mean()))
    return {k: round(float(np.mean(v)), 2) for k, v in out.items()}


def run_full(stim_group):
    from brian2 import Hz, ms
    from model import default_params, run_exp
    import utils as utl
    res = ROOT / "Drosophila_brain_model/results/validate"
    res.mkdir(parents=True, exist_ok=True)
    params = dict(default_params, n_run=N_RUN, t_run=1000 * ms, r_poi=RATE * Hz)
    stim_ids = [int(ids[i]) for i in circ.groups[stim_group]]
    run_exp(exp_name=stim_group, neu_exc=stim_ids, params=params, force_overwrite=True, n_proc=-1,
            path_res=str(res), path_comp=str(ROOT / "Drosophila_brain_model/Completeness_783.csv"),
            path_con=str(ROOT / "Drosophila_brain_model/Connectivity_783.parquet"))
    df = utl.load_exps([str(res / f"{stim_group}.parquet")])
    rate, _ = utl.get_rate(df, t_run=params["t_run"], n_run=N_RUN)
    col = rate[stim_group]
    return {k: round(float(np.mean([col.get(int(ids[i]), 0.0) for i in circ.groups[k]])), 2) for k in READ}


results = {}
for stim in ["LC10a_L", "LC10a_R"]:
    for name, fn in [("subgraph", lambda s: run_sub(circ, s)),
                     ("scrambled", lambda s: run_sub(circ.scrambled(seed=1), s)),
                     ("full_brain", run_full)]:
        t0 = time.time()
        r = fn(stim)
        r["_seconds"] = round(time.time() - t0, 1)
        r["DNa02_R_minus_L"] = round(r["DNa02_R"] - r["DNa02_L"], 2)
        results[f"{stim}/{name}"] = r
        print(f"{stim:8s} {name:10s} DNa02 L={r['DNa02_L']:6.1f} R={r['DNa02_R']:6.1f}  R-L={r['DNa02_R_minus_L']:+6.1f}  "
              f"AOTU019 L/R={r['AOTU019_L']:.0f}/{r['AOTU019_R']:.0f}  AOTU025 L/R={r['AOTU025_L']:.0f}/{r['AOTU025_R']:.0f}  "
              f"({r['_seconds']}s)", flush=True)

(ROOT / "output").mkdir(exist_ok=True)
(ROOT / "output/validation.json").write_text(json.dumps(results, indent=1))
print("已保存 output/validation.json")
