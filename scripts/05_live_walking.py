"""实验 5：在 MuJoCo 实时 3D 窗口里看数字果蝇边算边走（0.2 倍速慢放）。

macOS 必须用 mjpython 启动（不是 python）：
    flygym-play/.venv/bin/mjpython scripts/05_live_walking.py
窗口里：左键拖动旋转视角，右键平移，滚轮缩放；关掉窗口即结束。
"""
import time

import mujoco
import mujoco.viewer
import numpy as np

from flygym import Simulation
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

SLOWMO = 0.2      # 生物时间 / 真实时间
MAX_WALL_S = 40   # 最多演示 40 秒真实时间（= 8 秒生物时间）

fly = make_locomotion_fly(name="walker", add_adhesion=True, colorize=True)
world = FlatGroundWorld()
world.add_fly(fly, [0, 0, 0.5], Rotation3D("quat", [1, 0, 0, 0]))
sim = Simulation(world)

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

m, d = sim.mj_model, sim.mj_data
thorax_id = next(i for i in range(m.nbody) if "c_thorax" in (mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, i) or ""))

with mujoco.viewer.launch_passive(m, d, show_left_ui=False, show_right_ui=False) as viewer:
    with viewer.lock():
        viewer.cam.type = mujoco.mjtCamera.mjCAMERA_TRACKING  # 相机跟着胸部走
        viewer.cam.trackbodyid = thorax_id
        viewer.cam.distance = 9.0
        viewer.cam.azimuth = 120
        viewer.cam.elevation = -20
    start = time.perf_counter()
    bio_t = 0.0
    print("3D 窗口已打开：果蝇正在走路……")
    while viewer.is_running() and time.perf_counter() - start < MAX_WALL_S:
        target_bio = (time.perf_counter() - start) * SLOWMO
        while bio_t < target_bio:  # 追上应到的生物时间
            apply_locomotion_action(sim, fly.name, controller.step())
            sim.step()
            bio_t += sim.timestep
        viewer.sync()
        time.sleep(1 / 60)
    print(f"演示结束：共模拟 {bio_t:.2f} 秒生物时间")
