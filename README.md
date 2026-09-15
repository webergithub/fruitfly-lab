# fruitfly-lab · 数字果蝇实验台

2026-09-15 在本机（Apple M5 / 24 GB / macOS 26.5）跑通的入门实验。完整说明见 `docs/fruitfly-guide-v1.html`。

| 目录 | 内容 |
|---|---|
| `Drosophila_brain_model/` | Shiu et al. 2024 全脑 LIF 模型（git clone，自带 `.venv`，Python 3.11 + brian2 2.9 + numpy<2） |
| `flygym-play/` | FlyGym 2.1.0 数字果蝇身体（`.venv`，Python 3.12） |
| `flygym-src/` | FlyGym v2.1.0 源码，`tutorials/` 里是官方 notebook |
| `scripts/` | 01 糖→进食 / 02 走路视频 / 03 导出栅格 / 04 敲除实验，`*_output.log` 为实际运行输出 |
| `output/` | `walking_fly.mp4`、`sugar_raster.json` |

## 一键重跑（在本目录执行）

```bash
Drosophila_brain_model/.venv/bin/python scripts/01_sugar_to_feeding.py
flygym-play/.venv/bin/python scripts/02_walking_fly.py
Drosophila_brain_model/.venv/bin/python scripts/03_export_raster.py
Drosophila_brain_model/.venv/bin/python scripts/04_silence_neuron.py
```

## 从零重建环境

```bash
git clone --depth 1 https://github.com/philshiu/Drosophila_brain_model.git
uv venv --python 3.11 Drosophila_brain_model/.venv
uv pip install --python Drosophila_brain_model/.venv/bin/python brian2 "numpy<2" "pandas<3" pyarrow joblib matplotlib ipykernel

mkdir flygym-play
uv venv --python 3.12 flygym-play/.venv
uv pip install --python flygym-play/.venv/bin/python "flygym[examples]"
```

踩过的坑：brian2 2.9 + numpy 2.4 报 `ndarray has no attribute 'ptp'` → 装 `numpy<2`；`run_exp` 不会自建结果目录 → 脚本里先 `mkdir`。
