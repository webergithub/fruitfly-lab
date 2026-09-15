"""汇总 Doom 实验：各条件击杀/存活/命中率、配对置换检验、瞄准质量（来自第 1 局逐帧轨迹）。

用法（fruitfly-lab 目录下，先跑完 fly_doom.py 各条件）：
    doom-play/.venv/bin/python doom/analyze.py
输出：doom/results/analysis.json
"""
import json
from pathlib import Path

import numpy as np

R = Path(__file__).resolve().parent / "results"
ORDER = ["oracle", "fly", "lesion025", "scrambled_cal", "scrambled", "lesion", "random"]
BINO = 6.0
rng = np.random.default_rng(0)


def paired_perm_p(a, b, n=20000):
    """同一组随机种子下的配对符号翻转置换检验（双侧）。"""
    d = np.asarray(a, float) - np.asarray(b, float)
    obs = abs(d.mean())
    flips = rng.choice([-1, 1], size=(n, d.size))
    return float(((np.abs((flips * d).mean(axis=1)) >= obs - 1e-12).sum() + 1) / (n + 1))


def boot_ci(x, n=5000):
    x = np.asarray(x, float)
    m = rng.choice(x, size=(n, x.size)).mean(axis=1)
    return [round(float(np.percentile(m, 2.5)), 2), round(float(np.percentile(m, 97.5)), 2)]


def aim_quality(trace):
    seen = [f for f in trace if f["az"] is not None]
    if not seen:
        return {"frames_with_target": 0}
    off = [f for f in seen if abs(f["az"]) >= BINO]
    correct = sum(1 for f in off if (f["az"] > 0 and f["a"][1] and not f["a"][0]) or (f["az"] < 0 and f["a"][0] and not f["a"][1]))
    wrong = sum(1 for f in off if (f["az"] > 0 and f["a"][0] and not f["a"][1]) or (f["az"] < 0 and f["a"][1] and not f["a"][0]))
    fire_in = sum(1 for f in seen if f["a"][2] and abs(f["az"]) < BINO)
    fire_all = sum(1 for f in trace if f["a"][2])
    return {
        "frames": len(trace), "frames_with_target": len(seen),
        "centered_pct": round(100 * sum(1 for f in seen if abs(f["az"]) < BINO) / len(seen), 1),
        "turn_correct_pct": round(100 * correct / len(off), 1) if off else None,
        "turn_wrong_pct": round(100 * wrong / len(off), 1) if off else None,
        "median_abs_az": round(float(np.median([abs(f["az"]) for f in seen])), 1),
        "fire_frames": fire_all,
        "fire_on_target_pct": round(100 * fire_in / fire_all, 1) if fire_all else None,
    }


data = {p: json.loads((R / f"{p}.json").read_text()) for p in ORDER if (R / f"{p}.json").exists()}
fly_k = [e["kills"] for e in data["fly"]["episodes"]]
out = {"conditions": {}, "calibration": {}}
for p, d in data.items():
    kills = [e["kills"] for e in d["episodes"]]
    trace = json.loads((R / f"{p}_trace.json").read_text()) if (R / f"{p}_trace.json").exists() else []
    out["conditions"][p] = {
        **d["summary"], "episodes": len(kills), "kills_list": kills, "kills_ci95": boot_ci(kills),
        "p_vs_fly": None if p == "fly" else paired_perm_p(fly_k, kills),
        "aim": aim_quality(trace),
    }
for which in ["fly", "scrambled"]:
    f = R / f"calibration_{which}.json"
    if f.exists():
        out["calibration"][which] = json.loads(f.read_text())

# 第 1 局真实回路的一段时间序列（给文档画图）
ft = json.loads((R / "fly_trace.json").read_text())
out["fly_trace_head"] = ft[:700]
(R / "analysis.json").write_text(json.dumps(out, ensure_ascii=False))

print(f"{'条件':14s} {'击杀':>12s} {'95%CI':>14s} {'存活s':>7s} {'命中率':>6s} {'p(vs fly)':>9s} {'对准%':>6s} {'转对%':>6s} {'转错%':>6s}")
for p, c in out["conditions"].items():
    a = c["aim"]
    print(f"{p:14s} {c['kills']:6.1f}±{c['kills_sd']:<5.1f} {str(c['kills_ci95']):>14s} {c['survival_s']:7.1f} {c['accuracy']:6.2f} "
          f"{'—' if c['p_vs_fly'] is None else format(c['p_vs_fly'], '.4f'):>9s} {a.get('centered_pct', '—')!s:>6s} "
          f"{a.get('turn_correct_pct', '—')!s:>6s} {a.get('turn_wrong_pct', '—')!s:>6s}")
