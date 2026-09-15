"""实验 4：像神经科学家做"敲除实验"——一边给糖，一边把某个中间神经元关掉，看 MN9 还会不会放电。

先跑完 01。本脚本自动挑出糖味神经元之外最活跃的 3 个中间神经元，逐个静默。
用法（在 fruitfly-lab 目录下）：
    Drosophila_brain_model/.venv/bin/python scripts/04_silence_neuron.py
"""
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("exp1", HERE / "01_sugar_to_feeding.py")
exp1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exp1)  # 复用实验 1 的配置、神经元 ID 和模型函数

from brian2 import Hz  # noqa: E402

cfg, SUGAR, MN9 = exp1.config, exp1.SUGAR, exp1.MN9
params = dict(exp1.default_params, n_run=exp1.N_RUN, t_run=exp1.T_RUN, r_poi=150 * Hz)

base = exp1.utl.load_exps([f"{cfg['path_res']}/sugarR.parquet"])
rate, _ = exp1.utl.get_rate(base, t_run=params["t_run"], n_run=exp1.N_RUN)
rate = rate["sugarR"].drop(labels=SUGAR + [MN9], errors="ignore").sort_values(ascending=False)
targets = rate.index[:3].tolist()
print("糖味神经元之外最活跃的中间神经元：", {t: round(rate[t], 1) for t in targets})

results = {"不静默（对照）": exp1.utl.get_rate(base, params["t_run"], exp1.N_RUN)[0].loc[MN9, "sugarR"]}
conditions = [(f"静默 …{str(t)[-6:]}", f"silence_{t}", [t]) for t in targets]
conditions.append(("三个一起静默", "silence_top3", targets))  # 单个关掉没用时，试试一起关
for label, name, slnc in conditions:
    exp1.run_exp(exp_name=name, neu_exc=SUGAR, neu_slnc=slnc, params=params, force_overwrite=True, **cfg)
    df = exp1.utl.load_exps([f"{cfg['path_res']}/{name}.parquet"])
    r, _ = exp1.utl.get_rate(df, params["t_run"], exp1.N_RUN)
    results[label] = r.loc[MN9, name] if MN9 in r.index else 0.0

print("\nMN9 放电率对比（Hz）：")
for k, v in results.items():
    print(f"  {k:<28} {v:6.1f}  {'█' * int(v / 4)}")
