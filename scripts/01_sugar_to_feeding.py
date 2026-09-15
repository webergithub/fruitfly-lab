"""实验 1：戳一下果蝇的"糖味神经元"，看大脑里谁被点亮、喂食运动神经元 MN9 会不会放电。

基于 Shiu et al. 2024 (Nature) 的全脑 LIF 模型，12.7 万个神经元、FlyWire v630 连接组。
用法（在 fruitfly-lab 目录下）：
    Drosophila_brain_model/.venv/bin/python scripts/01_sugar_to_feeding.py
"""
import sys
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parent.parent / "Drosophila_brain_model"
sys.path.insert(0, str(MODEL_DIR))

from brian2 import Hz, ms  # noqa: E402
from model import run_exp, default_params  # noqa: E402
import utils as utl  # noqa: E402

N_RUN = 3          # 原论文 30 次，入门先跑 3 次省时间
T_RUN = 1000 * ms  # 每次模拟 1 秒生物时间

config = {
    "path_res": str(MODEL_DIR / "results" / "lab"),
    "path_comp": str(MODEL_DIR / "2023_03_23_completeness_630_final.csv"),
    "path_con": str(MODEL_DIR / "2023_03_23_connectivity_630_final.parquet"),
    "n_proc": -1,
}

# 右脑的 21 个糖味感受神经元（FlyWire ID，来自官方 example.ipynb）
SUGAR = [
    720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345,
    720575940617000768, 720575940630797113, 720575940632889389, 720575940621754367,
    720575940621502051, 720575940640649691, 720575940639332736, 720575940616885538,
    720575940639198653, 720575940620900446, 720575940617937543, 720575940632425919,
    720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
    720575940611875570,
]
MN9 = 720575940660219265  # 控制伸出口器（进食）的运动神经元

if __name__ == "__main__":
    Path(config["path_res"]).mkdir(parents=True, exist_ok=True)  # 原代码不会自动建目录，不建会在最后保存时报错
    params = dict(default_params, n_run=N_RUN, t_run=T_RUN, r_poi=150 * Hz)
    run_exp(exp_name="sugarR", neu_exc=SUGAR, params=params, force_overwrite=True, **config)

    df_spike = utl.load_exps([f"{config['path_res']}/sugarR.parquet"])
    names = {f: f"sugar_{i + 1}" for i, f in enumerate(SUGAR)}
    names[MN9] = "MN9 (进食运动神经元)"
    df_rate, _ = utl.get_rate(df_spike, t_run=params["t_run"], n_run=N_RUN, flyid2name=names)
    df_rate = df_rate.sort_values("sugarR", ascending=False)

    print(f"\n共 {len(df_spike):,} 次放电，{len(df_rate)} 个神经元有活动（全脑约 12.7 万个）")
    print("\n最活跃的 15 个神经元（Hz）：")
    print(df_rate.head(15).to_string())
    mn9 = df_rate.loc[MN9, "sugarR"] if MN9 in df_rate.index else 0.0
    print(f"\n>>> MN9 放电率 = {mn9:.1f} Hz  ——  {'大于 0：糖味信号一路传到了进食运动神经元！' if mn9 > 0 else '没有放电，试试调高 r_poi'}")
