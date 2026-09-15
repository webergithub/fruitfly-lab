"""果蝇玩 Doom：用 FlyWire 真实「视觉追踪→转向」回路（3,963 个神经元）在 ViZDoom 里转身瞄准、开火。

闭环（每个游戏 tic = 1/35 秒 = 286 个 0.1 ms 神经仿真步）：
  屏幕上的敌人 ──[工程化视觉编码]──> LC10a 左/右眼群体泊松刺激
  ──[真实连接组 LIF，不训练]──> AOTU019 / AOTU025 / DNa02 左右放电率
  ──[固定读出规则]──> 转向 = (DNa02_R−DNa02_L) + (AOTU019_R−AOTU019_L)；左右 AOTU019 同时活跃 → 开火

诚实标注：
  · 工程化：视觉编码（ViZDoom 物体标签给出敌人方位，代替复眼光学）、LC10a 视野位置代理、读出阈值、开火规则、
    没看到敌人时向右搜索。
  · 来自数据：子图内 354,879 条连接的结构与正负号；神经元方程与参数来自 Shiu et al. 2024。
  · 没有任何学习或训练；阈值由“扫描方位角”的标定一次确定后固定。
  · 读 AOTU019 的原因：子图里 DNa02 没有基线放电，AOTU019（GABA，投射对侧）的“去抑制转向”无法在 DN 上表现，
    因此直接读它的左右差作为中央视野转向信号（论文：AOTU019 负责 0–40° 中央视野）。

策略（--policy）：
  fly            真实接线
  scrambled      度保持打乱接线，沿用真实回路的阈值
  scrambled_cal  度保持打乱接线，用它自己的标定阈值（更公平的对照）
  lesion         敲除左右 AOTU019 + AOTU025
  lesion025      只敲除左右 AOTU025（外周视野通路）
  random         随机按键（下限）
  oracle         直接按敌人方位转向开火（不经大脑，上限）

用法（fruitfly-lab 目录下）：
  doom-play/.venv/bin/python doom/fly_doom.py --calibrate
  doom-play/.venv/bin/python doom/fly_doom.py --policy fly --episodes 10 --record
  doom-play/.venv/bin/python doom/fly_doom.py --policy fly --episodes 1 --visible   # 前台窗口实时玩
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import vizdoom as vzd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "flycircuit"))
from lif import LIF, Circuit  # noqa: E402

RESULTS = ROOT / "doom" / "results"
DT = 1e-4
STEPS_PER_TIC = round(1 / 35 / DT)  # 286
HALF_FOV_DOOM = 45.0                # Doom 水平视野 90°
FLY_SCALE = 2.0                     # 屏幕 ±45° → 果蝇视野 ±90°
BINO = 6.0                          # 双眼重叠区 ±6°（果蝇视野角），两侧 LC10a 同时受刺激
MAX_RATE = 150.0                    # LC10a 最大刺激频率 Hz
SIGMA = 0.3                         # LC10a 视野位置代理的调谐宽度
TAU_S = 0.1                         # 放电率平滑时间常数
PANEL = ["LC10a_L", "LC10a_R", "AOTU019_L", "AOTU019_R", "AOTU025_L", "AOTU025_R", "DNa02_L", "DNa02_R"]
CAL_AZ = [-90, -75, -60, -45, -30, -20, -10, -5, 0, 5, 10, 20, 30, 45, 60, 75, 90]
POLICIES = ["fly", "scrambled", "scrambled_cal", "lesion", "lesion025", "random", "oracle"]


def enemies(state):
    """屏幕上活着的敌人：[(果蝇视野方位角°, 强度 0–1)]。尸体（宽>高）不算。"""
    out = []
    for lb in state.labels:
        if lb.object_name == "DoomPlayer" or lb.height < 4 or lb.width > lb.height * 1.3:
            continue
        cx = lb.x + lb.width / 2
        az = (cx - 160) / 160 * HALF_FOV_DOOM * FLY_SCALE
        out.append((float(np.clip(az, -90, 90)), float(min(1.0, 0.35 + lb.height / 60))))
    return out


def steer_signal(r):
    return (r["DNa02_R"] - r["DNa02_L"]) + (r["AOTU019_R"] - r["AOTU019_L"])


class FlyBrain:
    def __init__(self, circuit, seed=0, silenced=()):
        self.c = circuit
        self.lif = LIF(circuit, dt=DT, seed=seed, silenced=silenced)
        g = circuit.groups
        self.lc = {"L": g["LC10a_L"], "R": g["LC10a_R"]}
        cen = np.array([nn.get("central", 0.5) for nn in circuit.meta["neurons"]])
        self.pref_ecc = 1.0 - cen
        self.idx = {k: g[k] for k in PANEL}
        self.alpha = np.exp(-(1 / 35) / TAU_S)
        self.rate = {k: 0.0 for k in PANEL}
        self.last_counts = None

    def stim_rates(self, targets):
        rates = np.zeros(self.c.n)
        for az, strength in targets:
            ecc = min(abs(az) / 90.0, 1.0)
            sides = ["L", "R"] if abs(az) < BINO else (["R"] if az > 0 else ["L"])
            for s in sides:
                ids = self.lc[s]
                tune = np.exp(-((self.pref_ecc[ids] - ecc) ** 2) / (2 * SIGMA ** 2))
                rates[ids] = np.minimum(MAX_RATE, rates[ids] + MAX_RATE * strength * tune)
        return rates

    def step(self, targets):
        cnt = self.lif.run(STEPS_PER_TIC, self.stim_rates(targets))
        self.last_counts = cnt
        hz = cnt / (STEPS_PER_TIC * DT)
        for k, ids in self.idx.items():
            self.rate[k] = self.alpha * self.rate[k] + (1 - self.alpha) * float(hz[ids].mean())
        return self.rate


def load_cal(name):
    f = RESULTS / f"calibration_{name}.json"
    return json.loads(f.read_text())["cal"]


def make_policy(name, circuit, seed):
    if name in ("random", "oracle"):
        rng = np.random.default_rng(seed)

        def act(targets):
            if name == "random":
                return [int(x) for x in rng.integers(0, 2, 3)], None
            if not targets:
                return [0, 1, 0], None
            az = min(targets, key=lambda t: abs(t[0]))[0]
            return [int(az < -BINO), int(az > BINO), int(abs(az) < BINO)], None
        return act, None

    c = circuit.scrambled(seed=seed + 100) if name.startswith("scrambled") else circuit
    kill = {"lesion": ["AOTU019_L", "AOTU019_R", "AOTU025_L", "AOTU025_R"], "lesion025": ["AOTU025_L", "AOTU025_R"]}.get(name, [])
    silenced = [i for k in kill for i in circuit.groups[k]]
    brain = FlyBrain(c, seed=seed, silenced=silenced)
    cal = load_cal("scrambled" if name == "scrambled_cal" else "fly")

    def act(targets):
        r = brain.step(targets)
        s = steer_signal(r)
        left, right = int(s < -cal["turn_th"]), int(s > cal["turn_th"])
        fire = int(min(r["AOTU019_L"], r["AOTU019_R"]) > cal["fire_th"])
        if not targets and sum(r.values()) < cal["quiet_th"]:
            left, right = 0, 1  # 没有视觉输入：向右搜索（与 oracle 相同的工程化行为）
        return [left, right, fire], dict(r)
    return act, brain


def new_game(visible=False, seed=0):
    g = vzd.DoomGame()
    g.load_config(os.path.join(vzd.scenarios_path, "defend_the_center.cfg"))
    g.set_window_visible(visible)
    g.set_mode(vzd.Mode.ASYNC_PLAYER if visible else vzd.Mode.PLAYER)
    g.set_labels_buffer_enabled(True)
    g.set_screen_format(vzd.ScreenFormat.RGB24)
    g.add_available_game_variable(vzd.GameVariable.KILLCOUNT)
    g.set_seed(seed)
    g.init()
    return g


def overlay(frame, rates, action, tic, kills, policy):
    from PIL import Image, ImageDraw
    img = Image.fromarray(frame).resize((640, 480), Image.NEAREST)
    canvas = Image.new("RGB", (920, 480), (13, 10, 7))
    canvas.paste(img, (0, 0))
    d = ImageDraw.Draw(canvas)
    d.text((656, 10), f"FLY BRAIN · {policy}", fill=(232, 184, 109))
    d.text((656, 26), f"FlyWire v783 · 3,963 LIF neurons", fill=(154, 143, 131))
    d.text((656, 42), f"t={tic / 35:5.1f}s   kills={kills}", fill=(232, 227, 220))
    for j, k in enumerate(PANEL):
        y = 70 + j * 40
        v = rates.get(k, 0.0) if rates else 0.0
        d.text((656, y), f"{k:10s} {v:6.1f} Hz", fill=(232, 227, 220))
        col = (201, 148, 74) if "DNa02" in k else (127, 199, 194) if "AOTU" in k else (140, 130, 120)
        d.rectangle([656, y + 15, 656 + int(min(v, 250) / 250 * 250), y + 25], fill=col)
    s = steer_signal(rates) if rates else 0.0
    d.text((656, 400), f"steer R-L = {s:+7.1f}", fill=(232, 227, 220))
    names = [n for n, on in zip(["LEFT", "RIGHT", "FIRE"], action) if on]
    d.text((656, 420), "ACTION: " + (" + ".join(names) or "-"), fill=(255, 120, 90) if action[2] else (232, 227, 220))
    return np.asarray(canvas)


def play(policy, episodes, seed, record=False, visible=False):
    circuit = Circuit()
    game = new_game(visible, seed)
    eps = []
    RESULTS.mkdir(parents=True, exist_ok=True)
    for ep in range(episodes):
        act, _ = make_policy(policy, circuit, seed + ep)
        game.new_episode()
        ammo0 = game.get_game_variable(vzd.GameVariable.AMMO2)
        frames, trace, t0 = [], [], time.time()
        while not game.is_episode_finished():
            st = game.get_state()
            targets = enemies(st)
            action, rates = act(targets)
            if ep == 0:
                near = min(targets, key=lambda t: abs(t[0]))[0] if targets else None
                trace.append({"az": None if near is None else round(near, 1), "a": action,
                              **({k: round(v, 1) for k, v in rates.items()} if rates else {})})
                if record:
                    frames.append(overlay(st.screen_buffer, rates, action, st.number,
                                          int(game.get_game_variable(vzd.GameVariable.KILLCOUNT)), policy))
            game.make_action(action)
        kills = int(game.get_game_variable(vzd.GameVariable.KILLCOUNT))
        shots = int(ammo0 - game.get_game_variable(vzd.GameVariable.AMMO2))
        tics = int(game.get_episode_time())
        eps.append({"episode": ep, "kills": kills, "shots": shots, "tics": tics,
                    "accuracy": round(kills / shots, 3) if shots else 0.0, "wall_s": round(time.time() - t0, 1)})
        print(f"[{policy}] ep{ep}: kills={kills} shots={shots} survived={tics / 35:.1f}s wall={eps[-1]['wall_s']}s", flush=True)
        if ep == 0:
            (RESULTS / f"{policy}_trace.json").write_text(json.dumps(trace))
            if record and frames:
                import imageio.v2 as imageio
                imageio.mimwrite(RESULTS / f"{policy}_ep0.mp4", frames, fps=35, quality=7, macro_block_size=1)
    game.close()
    k = np.array([e["kills"] for e in eps], dtype=float)
    summary = {"kills": round(float(k.mean()), 2), "kills_sd": round(float(k.std(ddof=1)) if len(k) > 1 else 0.0, 2),
               "shots": round(float(np.mean([e["shots"] for e in eps])), 2),
               "survival_s": round(float(np.mean([e["tics"] for e in eps])) / 35, 2),
               "accuracy": round(float(np.mean([e["accuracy"] for e in eps])), 3)}
    out = {"policy": policy, "episodes": eps, "summary": summary, "seed": seed}
    (RESULTS / f"{policy}.json").write_text(json.dumps(out, indent=1))
    print(f"[{policy}] 平均击杀 {summary['kills']} ± {summary['kills_sd']}，存活 {summary['survival_s']}s，命中率 {summary['accuracy']}")
    return out


def calibrate(which="fly", seed=0):
    """扫描方位角 −90°…+90°，测回路响应 → 转向调谐曲线，并据此定读出阈值（之后固定不变）。"""
    circuit = Circuit()
    c = circuit.scrambled(seed=seed + 100) if which == "scrambled" else circuit
    rows = []
    t0 = time.time()
    for az in CAL_AZ:
        brain = FlyBrain(c, seed=seed)
        for _ in range(10):
            brain.step([(float(az), 1.0)])
        acc = {k: 0.0 for k in PANEL}
        for _ in range(20):
            r = brain.step([(float(az), 1.0)])
            for k in PANEL:
                acc[k] += r[k] / 20
        rows.append({"az": az, **{k: round(v, 2) for k, v in acc.items()}, "steer": round(steer_signal(acc), 2)})
        print(f"[{which}] az={az:+4d}°  DNa02 L/R={acc['DNa02_L']:6.1f}/{acc['DNa02_R']:6.1f}  "
              f"AOTU019 L/R={acc['AOTU019_L']:6.1f}/{acc['AOTU019_R']:6.1f}  steer={rows[-1]['steer']:+7.1f}", flush=True)
    by = {r["az"]: r for r in rows}
    s0 = abs(by[0]["steer"])
    s_off = min(abs(by[-10]["steer"]), abs(by[10]["steer"]))
    turn_th = (s0 + s_off) / 2 if s_off > s0 else max(1.1 * s0, 1.0)
    fire_th = max(0.5 * min(by[0]["AOTU019_L"], by[0]["AOTU019_R"]), 1.0)
    cal = {"turn_th": round(turn_th, 2), "fire_th": round(fire_th, 2), "quiet_th": 5.0,
           "note": "turn_th = |steer| 在 0° 与 ±10° 的中点；fire_th = 0° 时双侧 AOTU019 较小者的一半"}
    (RESULTS / f"calibration_{which}.json").write_text(json.dumps({"rows": rows, "cal": cal, "seconds": round(time.time() - t0, 1)}, indent=1))
    print(f"[{which}] 读出阈值：{cal}  （{time.time() - t0:.1f}s）")
    return cal


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--policy", default="fly", choices=POLICIES)
    ap.add_argument("--episodes", type=int, default=10)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--visible", action="store_true")
    ap.add_argument("--calibrate", action="store_true")
    args = ap.parse_args()
    RESULTS.mkdir(parents=True, exist_ok=True)
    if args.calibrate:
        calibrate("fly", args.seed)
        calibrate("scrambled", args.seed)
    else:
        play(args.policy, args.episodes, args.seed, args.record, args.visible)
