"""实验 2：让 NeuroMechFly 数字果蝇身体在平地上走 2 秒，并导出视频。

基于 FlyGym 2.1 官方教程 4a（CPG 中枢模式发生器控制器）。
用法（在 fruitfly-lab 目录下）：
    flygym-play/.venv/bin/python scripts/02_walking_fly.py
输出：output/walking_fly.mp4
"""
from pathlib import Path

import numpy as np
from tqdm import trange

from flygym import Simulation
from flygym.anatomy import BodySegment
from flygym.compose import FlatGroundWorld
from flygym.utils.math import Rotation3D
from flygym_demo.complex_terrain import (
    CPGController,
    LocomotionAction,
    PreprogrammedSteps,
    apply_locomotion_action,
    make_locomotion_fly,
    make_tripod_cpg_network,
)

RUN_TIME = 2.0  # 秒（生物时间）
OUT_DIR = Path(__file__).resolve().parent.parent / "output"
OUT_DIR.mkdir(exist_ok=True)

# 1. 造一只带足底吸附力的果蝇，挂一个侧面跟拍相机
fly = make_locomotion_fly(name="walker", add_adhesion=True, colorize=True)
cam = fly.add_tracking_camera(
    name="side_cam",
    pos_offset=(-0.5, -7.5, 0.0),
    rotation=Rotation3D("euler", (1.57, 0.0, 0.0)),
    fovy=30.0,
)

# 2. 放进平地世界
world = FlatGroundWorld()
world.add_fly(fly, [0, 0, 0.5], Rotation3D("quat", [1, 0, 0, 0]))
sim = Simulation(world)
sim.set_renderer([cam], camera_res=(480, 640), playback_speed=0.25)  # 高、宽；0.25 倍速慢放

# 3. 三足步态 CPG：6 个耦合振荡器，每条腿一个
steps = PreprogrammedSteps()
dof_order = fly.get_actuated_jointdofs_order("position")
controller = CPGController(
    cpg_network=make_tripod_cpg_network(
        timestep=sim.timestep, intrinsic_amplitude=1.0,
        coupling_strength=10.0, convergence_coef=20.0, seed=0,
    ),
    preprogrammed_steps=steps,
    output_dof_order=dof_order,
)

sim.reset()
apply_locomotion_action(sim, fly.name, LocomotionAction(
    joint_angles=steps.default_pose_by_dof_order(dof_order),
    adhesion_onoff=np.ones(6, dtype=bool),
))
sim.warmup()

# 4. 主循环：控制器出动作 → 物理引擎走一步 → 需要时渲染一帧
thorax = fly.get_bodysegs_order().index(BodySegment("c_thorax"))
n_steps = int(RUN_TIME / sim.timestep)
start = sim.get_body_positions(fly.name)[thorax].copy()
for _ in trange(n_steps, desc="果蝇在走路"):
    apply_locomotion_action(sim, fly.name, controller.step())
    sim.step()
    sim.render_as_needed()
end = sim.get_body_positions(fly.name)[thorax]

video = OUT_DIR / "walking_fly.mp4"
sim.renderer.save_video(video)
print(f"\n{RUN_TIME}s 内胸部前进了 {np.linalg.norm(end[:2] - start[:2]):.2f} mm；视频已保存：{video}")
