# fruitfly-lab · Fly Marksman（果蝇神射手）

**A real fruit fly brain circuit, taken from the FlyWire connectome, aims and fires in your browser — no training.**
**用 FlyWire 真实果蝇大脑连接组中的视觉追踪回路，不经任何训练，在浏览器里实时瞄准射击。**

- Live demo / 在线体验: <https://opcstudio.cc/fly-aim/>
- Live 3D brain view / 实时大脑视图: <https://opcstudio.cc/fly-aim/?focus=brain>

The same 3,963-neuron circuit also plays Doom (ViZDoom *defend_the_center*). With its real wiring it scores 10.2 kills per episode; with the wiring scrambled it scores 0.7.
同一个 3,963 神经元的回路还能玩 Doom：真实接线平均每局击杀 10.2，打乱接线后只有 0.7。

---

## What it is / 这是什么

Fruit flies steer toward small moving objects using a well-described visual pathway:
果蝇追踪移动小物体时使用一条研究清楚的视觉通路：

```
LC10a  (detects small moving objects / 检测小的移动物体, 115 left + 119 right)
  ├─> AOTU019  (GABA, projects contralaterally, central field 0–40° / 抑制性，投射对侧，中央视野)
  └─> AOTU025  (acetylcholine, ipsilateral, periphery 40–90° / 兴奋性，投射同侧，外周视野)
        └─> DNa02  (steering descending neuron / 转向下行神经元; right−left firing difference sets the turn)
```

This project extracts that circuit from the **FlyWire v783 adult female whole-brain connectome**, simulates every neuron as a spiking leaky integrate-and-fire (LIF) unit with the parameters of **Shiu et al. 2024 (Nature)**, and connects it to games:
本项目从 FlyWire v783 雌性果蝇全脑连接组中抽出这条回路，用 Shiu 等人 2024 年 Nature 论文的 LIF 参数模拟每个神经元，再接到游戏上：

| Component / 组成 | Detail / 细节 |
|---|---|
| Subgraph / 子图 | 3,963 neurons, 354,879 connections (38% inhibitory). Paths with ≥ 5 synapses, ≤ 2 hops from LC10a and from 5 steering DNs (DNa01/02/03/04/11). |
| Synapse weight / 突触权重 | synapse count × sign (predicted neurotransmitter) × 0.275 mV, delay 1.8 ms |
| Neuron / 神经元 | v_rest −52 mV, threshold −45 mV, membrane τ 20 ms, synaptic τ 5 ms, refractory 2.2 ms, step 0.1 ms |
| Web game / 网页 | Three.js scene; the LIF network runs in a Web Worker at 1× real time; live layer map of all 3,963 neurons and a 3D point cloud of 139,248 FlyWire soma positions |
| Doom | ViZDoom; each game tic (1/35 s) = 286 simulation steps; numba kernel |

## How the brain is connected to the game / 大脑怎么接到游戏上

1. **Vision encoder (engineered)** — the target's bearing drives Poisson input (≤ 150 Hz) into LC10a cells of the matching eye; within ±6° both eyes are stimulated (binocular zone). Each LC10a cell's preferred eccentricity is proxied by whether it wires more to AOTU019 (central) or AOTU025 (periphery).
   **视觉编码（工程设定）**：目标方位角 → 对应眼的 LC10a 泊松刺激；±6° 内两侧同时刺激。
2. **Connectome (real data)** — spikes propagate through the 354,879 real connections. Nothing is trained.
   **连接组（真实数据）**：放电沿真实连接传播，没有任何训练。
3. **Readout (engineered, fixed)** — `steer = (DNa02_R − DNa02_L) + (AOTU019_R − AOTU019_L)`; fire when both AOTU019 exceed a threshold. Thresholds come from a single azimuth calibration sweep (turn 130.9, fire 95.7).
   **读出（工程设定，固定）**：转向信号超过阈值就转；左右 AOTU019 同时活跃就开火。
4. **Action** — Doom: TURN_LEFT / TURN_RIGHT / ATTACK buttons. Web: turn rate proportional to the steer signal.

## Results / 结果

**Validation against the full brain / 与全脑模型对照**（stimulate one eye's LC10a at 100 Hz, 5 × 1 s）

| Stimulus | Model | DNa02 L (Hz) | DNa02 R (Hz) | Direction |
|---|---|---|---|---|
| Left eye | Full brain (139k neurons, Brian2) | 105.6 | 0.0 | same side ✓ |
| Left eye | Subgraph (3,963) | 103.8 | 0.0 | same side ✓ |
| Left eye | Subgraph, scrambled | 21.0 | 0.2 | weak |
| Right eye | Full brain | 0.0 | 58.8 | same side ✓ |
| Right eye | Subgraph | 0.0 | 4.0 | same side, weak |
| Right eye | Subgraph, scrambled | 46.0 | 0.0 | **wrong side** |

**Doom defend_the_center, 10 episodes per condition, same seeds / 每组 10 局**

| Condition / 条件 | Kills per episode | p vs real |
|---|---|---|
| Oracle: turn to the true enemy bearing (no brain) / 上限 | 11.5 ± 3.5 | 0.35 |
| **Real connectome / 真实连接组** | **10.2 ± 4.5** | — |
| AOTU025 silenced / 敲除 AOTU025 | 5.5 ± 5.0 | 0.048 |
| Scrambled wiring, own calibration / 打乱接线 | 0.7 ± 0.7 | 0.002 |
| Random buttons / 随机按键 | 0.9 ± 0.3 | 0.002 |

Scrambling keeps every neuron's out-degree, in-degree and sign (Dale's law) and shuffles only who connects to whom. p values: paired sign-flip permutation test.

## What is real and what is engineered / 哪些是真的，哪些是工程设定

- **Real**: neurons, connections, synapse counts and signs (FlyWire v783); neuron equations (Shiu et al. 2024).
- **Engineered**: target bearing comes from game object labels, not from compound-eye optics; LC10a visual position is a wiring-based proxy; the steer/fire readout reads AOTU019 because DNa02 has no baseline activity in the subgraph; thresholds are calibrated once.
- **Not simulated**: learning, memory, neuromodulation, the rest of the brain, the body and flight. This is not an "uploaded fly".
- Silencing both AOTU019 and AOTU025 drops kills to 0 partly because the fire readout uses AOTU019; the AOTU025-only lesion is the more informative result. n = 10 episodes per condition.

## Repository layout / 目录

| Path | Contents |
|---|---|
| `fly-aim/` | Web game (static site): `index.html`, `js/lif-worker.js` (LIF in a Web Worker), `js/neural-panel.js` (live circuit map, 3D brain), `data/` (circuit + calibration) |
| `flycircuit/` | `extract.py` (subgraph from FlyWire), `lif.py` (numba/numpy LIF), `validate.py` (subgraph vs full brain), `export_brain_cloud.py` |
| `circuit/` | `meta.json` (neurons, groups, coordinates) + `edges.bin` (CSR) |
| `doom/` | `fly_doom.py` (7 conditions), `analyze.py` (stats), `live_demo.py` (visible window + recording) |
| `docs/` | Beginner guide and experiment report (Chinese) |
| `scripts/` | Starter experiments: whole-brain sugar → feeding neuron, NeuroMechFly walking, neuron silencing |

## Run it yourself / 自己运行

```bash
# web game (no build step)
node fly-aim/tools/serve.mjs 8765   # then open http://localhost:8765

# environments (uv)
git clone --depth 1 https://github.com/philshiu/Drosophila_brain_model.git
uv venv --python 3.11 Drosophila_brain_model/.venv
uv pip install --python Drosophila_brain_model/.venv/bin/python brian2 "numpy<2" "pandas<3" pyarrow joblib numba
uv venv --python 3.12 doom-play/.venv
uv pip install --python doom-play/.venv/bin/python vizdoom numpy pandas pyarrow numba imageio imageio-ffmpeg pillow
curl -sL -o data/flywire_annotations_783.tsv https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv

# pipeline
Drosophila_brain_model/.venv/bin/python flycircuit/extract.py     # -> circuit/
Drosophila_brain_model/.venv/bin/python flycircuit/validate.py    # subgraph vs full brain (~4 min)
doom-play/.venv/bin/python doom/fly_doom.py --calibrate
doom-play/.venv/bin/python doom/fly_doom.py --policy fly --episodes 10 --record
doom-play/.venv/bin/python doom/analyze.py
doom-play/.venv/bin/python doom/live_demo.py fly --record          # visible Doom window
```

Tested on Apple M5 / macOS 26.5. `brian2` 2.9 needs `numpy<2`.

## Sources / 引用

- FlyWire connectome & annotations (Dorkenwald et al. 2024; Schlegel et al. 2024): <https://github.com/flyconnectome/flywire_annotations>
- Drosophila whole-brain LIF model (Shiu et al. 2024, Nature): <https://github.com/philshiu/Drosophila_brain_model>
- Specialized parallel pathways for adaptive control of visual object pursuit (Neuron, 2026): <https://www.cell.com/neuron/fulltext/S0896-6273(26)00001-2>
- ViZDoom: <https://vizdoom.farama.org/>
- Related community projects: <https://github.com/cobanov/awesome-fly>

Built by [OPC Studio](https://opcstudio.cc/).
