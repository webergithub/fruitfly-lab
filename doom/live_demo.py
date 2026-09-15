"""前台演示：Doom 窗口里实时看果蝇回路瞄准开火，终端每半秒打印关键神经元放电率；可同时录像。

与 fly_doom.py 同一个大脑、编码与读出规则，只是窗口可见、分辨率更大、按真实时间 35 帧/秒推进。
用法（fruitfly-lab 目录下）：
    doom-play/.venv/bin/python doom/live_demo.py fly --record
    doom-play/.venv/bin/python doom/live_demo.py scrambled_cal --record
录像：videos/doom-<条件>-<时间戳>.mp4（左边游戏画面，右边实时神经活动面板）
"""
import argparse
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import vizdoom as vzd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fly_doom as fd  # noqa: E402

VIDEOS = Path(__file__).resolve().parent.parent / "videos"
NAMES = {"fly": "真实连接组", "scrambled_cal": "打乱接线（对照）", "scrambled": "打乱接线（对照）",
         "lesion": "敲除 AOTU019+AOTU025", "lesion025": "敲除 AOTU025", "oracle": "不经大脑（上限）", "random": "随机按键"}


def enemies(state):
    """与 fd.enemies 相同，但按实际屏幕宽度换算（窗口用 800×600）。"""
    w = state.screen_buffer.shape[1]
    k = w / 320
    out = []
    for lb in state.labels:
        if lb.object_name == "DoomPlayer" or lb.height < 4 * k or lb.width > lb.height * 1.3:
            continue
        az = (lb.x + lb.width / 2 - w / 2) / (w / 2) * fd.HALF_FOV_DOOM * fd.FLY_SCALE
        out.append((float(np.clip(az, -90, 90)), float(min(1.0, 0.35 + lb.height / (60 * k)))))
    return out


def bar(v, full=250, width=10):
    n = int(round(min(v, full) / full * width))
    return "█" * n + "·" * (width - n)


def run(policy, record=False, seed=0):
    g = vzd.DoomGame()
    g.load_config(os.path.join(vzd.scenarios_path, "defend_the_center.cfg"))
    g.set_window_visible(True)
    g.set_mode(vzd.Mode.PLAYER)
    g.set_labels_buffer_enabled(True)
    g.set_screen_resolution(vzd.ScreenResolution.RES_800X600)
    g.set_screen_format(vzd.ScreenFormat.RGB24)
    g.add_available_game_variable(vzd.GameVariable.KILLCOUNT)
    g.set_seed(seed)
    g.init()
    act, _ = fd.make_policy(policy, fd.Circuit(), seed=seed)
    writer, path = None, None
    if record:
        import imageio.v2 as imageio
        VIDEOS.mkdir(exist_ok=True)
        path = VIDEOS / f"doom-{policy}-{datetime.now():%Y%m%d-%H%M%S}.mp4"
        writer = imageio.get_writer(path, fps=35, quality=7, macro_block_size=1)
    g.new_episode()
    print(f"\n▶ {NAMES.get(policy, policy)} 开始，Doom 窗口已打开（敌人会从四面八方走来）" + (f"，录像中 → {path.name}" if record else "") + "\n")
    t0, tic, kills = time.time(), 0, 0
    while not g.is_episode_finished():
        st = g.get_state()
        action, r = act(enemies(st))
        if writer:
            writer.append_data(fd.overlay(st.screen_buffer, r, action, st.number, kills, policy))
        g.make_action(action)
        kills = int(g.get_game_variable(vzd.GameVariable.KILLCOUNT))
        tic += 1
        if tic % 17 == 0 and r:
            names = [n for n, on in zip(["左转", "右转", "开火🔥"], action) if on] or ["—"]
            print(f"t={tic / 35:5.1f}s 击杀{kills:2d} │ AOTU019 L {bar(r['AOTU019_L'])} R {bar(r['AOTU019_R'])} │ "
                  f"DNa02 L {r['DNa02_L']:5.0f} R {r['DNa02_R']:5.0f} Hz │ {' '.join(names)}", flush=True)
        delay = t0 + tic / 35 - time.time()
        if delay > 0:
            time.sleep(delay)
    survived = g.get_episode_time() / 35
    if writer:
        writer.close()
    print(f"\n■ {NAMES.get(policy, policy)} 结束：击杀 {kills}，存活 {survived:.1f} 秒" + (f"\n  视频已保存：{path}" if path else ""))
    time.sleep(2.5)
    g.close()
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("policy", nargs="?", default="fly", choices=fd.POLICIES)
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    run(a.policy, a.record, a.seed)
