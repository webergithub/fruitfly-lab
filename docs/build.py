"""把 guide.src.html 的占位符替换成实测数据，生成 fruitfly-guide-v1.html。"""
from pathlib import Path
import shutil
D = Path(__file__).resolve().parent
src = (D / "guide.src.html").read_text()
raster = (D.parent / "output" / "sugar_raster.json").read_text()
rows = [("不静默（对照）", 82.3, True), ("静默 …695448", 79.7, False), ("静默 …888530", 80.0, False),
        ("静默 …383685", 88.7, False), ("三个一起静默", 82.3, False)]
bars = "".join(
    f'<div class="bar{" base" if base else ""}"><span>{k}</span><div class="track"><div class="fill" style="width:{v}%"></div></div><span class="v">{v:.1f} Hz</span></div>'
    for k, v, base in rows)
take = ("<b>结果出乎意料</b>：无论单个还是三个一起关掉，MN9 都维持在 80–89 Hz，差异在随机波动范围内（每个条件只跑了 3 次，每次的随机刺激不同）。"
        "说明这几个“最吵”的中间神经元并不在糖→进食的必经之路上：<b>活跃不等于必需</b>。Shiu 论文正是用系统性的逐个敲除找到真正关键的少数神经元。"
        "你的下一个实验：把静默对象换成下游更靠近 MN9 的神经元，或把 <code>N_RUN</code> 调到 30 让结论更可靠。")
out = src.replace("/*RASTER_JSON*/", raster).replace("<!--SILENCE_BARS-->", bars).replace("<!--SILENCE_TAKEAWAY-->", take)
assert "/*RASTER_JSON*/" not in out and "<!--SILENCE" not in out
(D / "fruitfly-guide-v1.html").write_text(out)
shutil.copy(D.parent / "output" / "walking_fly.mp4", D / "walking_fly.mp4")
print("built", len(out), "bytes")
