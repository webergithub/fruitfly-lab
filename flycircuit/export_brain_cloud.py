"""导出 FlyWire 全脑约 13.9 万个神经元的胞体位置，作为网页「大脑 3D」视图的背景点云。

格式：Int16 小端，每个神经元 x,y,z 三个数，单位 0.1 μm（FlyWire 体素 4×4×40 nm 已换算）。
用法（fruitfly-lab 目录下）：
    doom-play/.venv/bin/python flycircuit/export_brain_cloud.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
a = pd.read_csv(ROOT / "data/flywire_annotations_783.tsv", sep="\t", low_memory=False,
                usecols=["soma_x", "soma_y", "soma_z", "pos_x", "pos_y", "pos_z"])
x = a.soma_x.fillna(a.pos_x) * 4e-3
y = a.soma_y.fillna(a.pos_y) * 4e-3
z = a.soma_z.fillna(a.pos_z) * 40e-3
ok = x.notna() & y.notna() & z.notna()
xyz = np.stack([x[ok], y[ok], z[ok]], axis=1) * 10
assert np.abs(xyz).max() < 32767
xyz = np.round(xyz).astype("<i2")
out = ROOT / "fly-aim/data/brain_cloud.bin"
xyz.tofile(out)
print(f"{len(xyz):,} 个神经元胞体 → {out}（{out.stat().st_size / 1e6:.2f} MB）；范围 μm：",
      (xyz.min(axis=0) / 10).tolist(), (xyz.max(axis=0) / 10).tolist())
