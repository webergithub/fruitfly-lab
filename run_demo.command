#!/bin/zsh
# 数字果蝇实验台 · 前台演示：双击或 `open run_demo.command` 运行
cd "$(dirname "$0")"
mkdir -p logs
exec > >(tee logs/demo_run.log) 2>&1

BRAIN=Drosophila_brain_model/.venv/bin/python
BODY=flygym-play/.venv/bin

banner() { print; print "════════════════════════════════════════════════════════"; print "  $1"; print "════════════════════════════════════════════════════════"; sleep 2; }

banner "实验 1 / 全脑模型：刺激 21 个糖味神经元，看进食运动神经元 MN9"
$BRAIN scripts/01_sugar_to_feeding.py

banner "实验 4 / 敲除实验：关掉最活跃的中间神经元，MN9 会变吗？（约 50 秒）"
$BRAIN scripts/04_silence_neuron.py 2>&1 | grep -v "WARNING"

banner "实验 2 / 数字身体：三足步态走 2 秒并导出视频"
$BODY/python scripts/02_walking_fly.py 2>&1 | tr '\r' '\n' | grep -v "it/s"

banner "实验 5 / 实时 3D 窗口：看果蝇边算边走（可用鼠标拖动视角，关窗口即结束）"
$BODY/mjpython scripts/05_live_walking.py

banner "播放导出的视频"
open output/walking_fly.mp4

print "\n全部完成 ✔  日志：logs/demo_run.log"
