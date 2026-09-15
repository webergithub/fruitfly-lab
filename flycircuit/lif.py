"""子图 LIF 仿真，与 Shiu et al. 2024 Brian2 全脑模型同一套方程与参数。

    dv/dt = (v0 - v + g) / t_mbr        （不应期内不积分）
    dg/dt = -g / tau
    放电：v > v_th → v = v_rst, g = 0, 不应期 2.2 ms
    突触：前神经元放电 1.8 ms 后，g_post += 突触数 × 正负号 × 0.275 mV
    外部刺激：泊松脉冲直接给 v 加 68.75 mV（必然放电）
    静默（敲除）：神经元钳在静息电位，不放电、不输出
有 numba 时用 JIT 内核（快约 50 倍），否则退回 numpy。网页端 fly-aim/js/lif-worker.js 是 JS 版本。
"""
import json
from pathlib import Path

import numpy as np

try:
    from numba import njit
except ImportError:  # pragma: no cover
    njit = None

CIRCUIT_DIR = Path(__file__).resolve().parent.parent / "circuit"


class Circuit:
    def __init__(self, path=CIRCUIT_DIR):
        path = Path(path)
        self.meta = json.loads((path / "meta.json").read_text())
        n, m = self.meta["n_neurons"], self.meta["n_edges"]
        raw = (path / "edges.bin").read_bytes()
        o = 4 * (n + 1)
        self.offsets = np.frombuffer(raw, np.uint32, n + 1, 0).astype(np.int64)
        self.post = np.frombuffer(raw, np.uint16, m, o).astype(np.int64)
        self.w = np.frombuffer(raw, np.int16, m, o + 2 * m).astype(np.float64) * self.meta["w_syn_mv"]
        self.n, self.m = n, m
        self.groups = {k: np.array(v) for k, v in self.meta["groups"].items()}

    def scrambled(self, seed=0):
        """度保持重连对照：每个神经元的出度、入度、正负号（Dale 定律）不变，只打乱"连给谁"。"""
        c = object.__new__(Circuit)
        c.__dict__.update(self.__dict__)
        c.post = np.random.default_rng(seed).permutation(self.post)
        return c


if njit:
    @njit(cache=True)
    def _seed(s):
        np.random.seed(s)

    @njit(cache=True)
    def _kernel(n_steps, t, v, g, rfc, buf, offsets, post, w, mute, p_spk,
                v0, vr, vth, a_v, decay_g, rfc_steps, dly, kick, counts):
        n = v.shape[0]
        rows = dly + 1
        for _ in range(n_steps):
            slot = t % rows
            dst = (t + dly) % rows
            for i in range(n):
                g[i] += buf[slot, i]
                buf[slot, i] = 0.0
                if mute[i]:
                    v[i] = v0
                    g[i] = 0.0
                    continue
                if rfc[i] <= 0:
                    v[i] += a_v * (v0 - v[i] + g[i])
                    g[i] *= decay_g
                rfc[i] -= 1
                if p_spk[i] > 0.0 and np.random.random() < p_spk[i]:
                    v[i] += kick
                if v[i] > vth:
                    v[i] = vr
                    g[i] = 0.0
                    rfc[i] = rfc_steps
                    counts[i] += 1
                    for k in range(offsets[i], offsets[i + 1]):
                        buf[dst, post[k]] += w[k]
            t += 1
        return t


class LIF:
    def __init__(self, circuit: Circuit, dt=1e-4, seed=0, silenced=(), use_numba=True):
        p = circuit.meta["params"]
        self.c, self.dt = circuit, dt
        self.v0, self.vr, self.vth = float(p["v0"]), float(p["v_rst"]), float(p["v_th"])
        self.a_v = dt * 1e3 / p["t_mbr_ms"]
        self.decay_g = float(np.exp(-dt * 1e3 / p["tau_ms"]))
        self.rfc_steps = int(round(p["t_rfc_ms"] * 1e-3 / dt))
        self.dly = int(round(p["t_dly_ms"] * 1e-3 / dt))
        self.kick = float(p["poisson_kick_mv"])
        n = circuit.n
        self.v = np.full(n, self.v0)
        self.g = np.zeros(n)
        self.rfc = np.zeros(n, dtype=np.int64)
        self.buf = np.zeros((self.dly + 1, n))
        self.t = 0
        self.mute = np.zeros(n, dtype=np.bool_)
        self.mute[list(silenced)] = True
        self.numba = bool(njit) and use_numba
        if self.numba:
            _seed(seed)
        self.rng = np.random.default_rng(seed)

    def run(self, n_steps, rates_hz):
        """跑 n_steps 步，rates_hz 为每个神经元的泊松刺激频率（长度 n）。返回每个神经元的放电次数。"""
        c = self.c
        counts = np.zeros(c.n, dtype=np.int64)
        p_spk = np.asarray(rates_hz, dtype=np.float64) * self.dt
        if self.numba:
            self.t = _kernel(n_steps, self.t, self.v, self.g, self.rfc, self.buf, c.offsets, c.post, c.w, self.mute,
                             p_spk, self.v0, self.vr, self.vth, self.a_v, self.decay_g, self.rfc_steps, self.dly,
                             self.kick, counts)
            return counts
        stim = np.flatnonzero(p_spk > 0)
        rows = self.dly + 1
        for _ in range(n_steps):
            slot = self.t % rows
            self.g += self.buf[slot]
            self.buf[slot] = 0.0
            active = self.rfc <= 0
            self.v[active] += self.a_v * (self.v0 - self.v[active] + self.g[active])
            self.g[active] *= self.decay_g
            self.rfc -= 1
            if stim.size:
                hit = stim[self.rng.random(stim.size) < p_spk[stim]]
                self.v[hit] += self.kick
            self.v[self.mute], self.g[self.mute] = self.v0, 0.0
            spk = np.flatnonzero(self.v > self.vth)
            if spk.size:
                counts[spk] += 1
                self.v[spk], self.g[spk], self.rfc[spk] = self.vr, 0.0, self.rfc_steps
                starts, ends = c.offsets[spk], c.offsets[spk + 1]
                lens = ends - starts
                if lens.sum():
                    eidx = np.repeat(ends - lens.cumsum(), lens) + np.arange(lens.sum())
                    np.add.at(self.buf[(self.t + self.dly) % rows], c.post[eidx], c.w[eidx])
            self.t += 1
        return counts
