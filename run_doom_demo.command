#!/bin/zsh
# 果蝇玩 Doom · 前台演示 + 录像：双击或 `open run_doom_demo.command`
cd "$(dirname "$0")"
mkdir -p logs videos
exec > >(tee logs/doom_demo.log) 2>&1
P=doom-play/.venv/bin/python
SEED=${SEED:-$(( RANDOM % 1000 ))}

banner() { print; print "════════════════════════════════════════════════════════════════════"; print "  $1"; print "════════════════════════════════════════════════════════════════════"; sleep 2; }

banner "① 真实果蝇连接组（FlyWire v783，3,963 个神经元，不训练）玩 Doom  · 种子 $SEED"
$P doom/live_demo.py fly --record --seed $SEED

banner "② 对照：打乱接线——神经元数、每个神经元的连接数和正负号都不变，只打乱连给谁  · 同一种子"
$P doom/live_demo.py scrambled_cal --record --seed $SEED

banner "③ 统计结果：每个条件 10 局（同样的随机种子）"
$P doom/analyze.py

print "\n本次视频："
ls -lh videos/doom-*.mp4 | tail -2
open "$(ls -t videos/doom-fly-*.mp4 | head -1)"
print "\n全部完成 ✔  日志：logs/doom_demo.log"
