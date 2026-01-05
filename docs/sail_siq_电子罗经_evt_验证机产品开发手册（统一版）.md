# SailSIQ Electronic Compass

## EVT 验证机 · 产品开发手册（统一版）

**Version:** EVT-V1.1\
**Status:** Internal / Engineering Draft\
**Scope:** 电子罗经验证机（EVT）硬件 + 固件 + UI + 赛场/起航/航段闭环功能 + 数据记录（为复盘平台服务）

---

## 0. 术语与目标

### 0.1 术语（Glossary）

- **SOG**: Speed Over Ground（对地航速）
- **COG**: Course Over Ground（对地航向）
- **Heading**: 船首航向（融合输出）
- **VMG**: Velocity Made Good（有效速度）
- **DTG**: Distance To Go（到目标距离）
- **BRG**: Bearing（指向目标方位角）
- **TTL/TTG**: Time To Line/Go（到线/到目标时间）
- **Burn/Late**: 起航“烧时间/晚到”
- **OCS**: On Course Side（提前越线风险）
- **Fleet**: 群发赛（Fleet race）
- **Match**: 对抗赛（Match race）

### 0.2 EVT 验证机的核心目标（Exit Criteria）

EVT 必须证明：

1. **航向可用且可信**：静止稳定、转动响应自然、输出可信度
2. **GNSS 可用**：定位/时间稳定、可记录、可用于实时计算
3. **竞赛闭环可用**：Start → Upwind → Downwind → Finish 一条链跑通
4. **数据可用**：日志能被 SailSIQ 复盘/教学平台直接消费

> EVT 不追求“全自动教练”，但要做到“在水上确实好用”。

---

## 1. 产品定位（Product Positioning）

### 1.1 产品定位

SailSIQ 电子罗经验证机是一台面向竞赛与训练的航海仪表，提供：

- 可靠的 **Heading/COG/SOG**
- 可配置的 **赛场（Course）与航标（Marks）**
- 竞赛核心闭环：**起航 Start + 航段/绕标/冲线场景**
- 全程 **日志记录**，为复盘平台提供原始输入

### 1.2 主要场景（Scenarios）

- Fleet 起航：可配置倒计时时间（默认 5min，支持任意分钟数）+ 线位 + Burn/Late
- Match 起航：**两步设置（开始时间/进 Box 时间，默认 5min/4min）+ Box 区管理 + 航速参考（Dial‑up / 冲刺）+ Burn/Late**
- 航段：迎风/顺风对标（进标阶段）
- 冲线：迎风/顺风冲线（Finish line guidance）

---

## 2. 系统总体架构（System Architecture）

### 2.1 硬件框图

```
[ Battery ]
    |
[ Power Mgmt ]
    |
[ ESP32-S3 MCU ]
  |      |      |
 IMU   GNSS   Display
(BMI) (UART) (E-Ink)
  |
Magnetometer (I2C/SPI)
  |
 Storage (SD / Flash)
  |
 BLE / Wi-Fi
```

### 2.2 核心器件（EVT 选型）

| 模块           | 推荐                     | 说明                   |
| ------------ | ---------------------- | -------------------- |
| MCU          | ESP32-S3               | 任务调度 + 记录 + BLE      |
| IMU          | BMI160                 | roll/pitch/yaw\_rate |
| Magnetometer | BMM150 / IST8310       | **强烈建议**：静止航向需要      |
| GNSS         | MG-F10（UBX）            | 1–10Hz，输出位置/速度/时间    |
| Display      | 800×400 E-Ink          | 低功耗，静态可读             |
| Storage      | microSD 或 QSPI Flash   | EVT 推荐 SD（调试方便）      |
| Power        | 1S 锂电 + 充电 + 3.3V DCDC | 避免 LDO 压差发热          |

### 2.3 SPI/I2C 资源规划（建议）

- SPI Host A：E-Ink（高带宽，避免与 IMU 抢占）
- SPI Host B：BMI160 + microSD（片选共享）
- I2C：Magnetometer（或 SPI 也可）

---

## 3. 电源与 RF/结构注意事项

### 3.1 电源策略（EVT 最省心）

- **1S 电池**（LiPo/18650/21700）
- **3.3V 优先 DCDC**（墨水屏刷新/无线峰值电流更稳）
- 电量检测：EVT 可先用分压 ADC + RC 滤波

### 3.2 RF 与材料（重要）

- **碳纤维外壳会显著影响 2.4GHz/Wi‑Fi 与 GNSS 信号**：需要 RF 窗口或外置天线
- EVT 阶段建议：玻纤壳先把信号跑通

### 3.3 传感器布置

- BMI160 尽量放 PCB 几何中心
- 远离 DCDC 电感、屏幕 FPC、强电流走线
- 磁力计远离磁性材料/螺丝/扬声器（验证机先别上磁吸结构）

---

## 4. 功能模块总览（Feature Modules）

### 4.1 核心导航（Core Navigation）

- **Heading（主航向）**：以磁罗盘为主（tilt-compensated），用于主 UI/指向
- **COG/SOG（对地航向/航速）**：用于几何计算（VMG/TTL/到线垂距等）
- Roll / Pitch / Yaw rate
- GNSS Fix / Sat count / 时间
- Heading confidence（0–100%）
- **Crab/Drift 指标（基于 Heading vs COG）**：输出对地“蟹行/漂移”数据，供水手自行判断（可选报警）

### 4.2 赛场（Course）

- Start line（Pin + Boat）
- Finish line（FP + FB）
- Marks：WM/LM
- Waypoints
- 每个 Mark 配置：**rounding\_side = PORT / STARBOARD**

### 4.3 VMG（实时）

- VMG→Mark（唯一支持，基于 GNSS）

### 4.4 起航（Start）

- Fleet：倒计时 + SYNC + 到线垂距 + Burn/Late
- Match：**两步设置（开始时间/进 Box 时间）+ 航速显示（启航前Dial‑up / 冲刺）+ 进 Box 与起航的 Burn/Late**

### 4.5 航段闭环场景（新增 4 个场景模块）（新增 4 个场景模块）

- 迎风对标（Upwind Mark Approach）
- 顺风对标（Downwind Mark Approach）
- 迎风冲线（Upwind Finish Line）
- 顺风冲线（Downwind Finish Line）

### 4.6 数据记录（Logging）

- **上电即开始记录**：设备启动后立即开始写卡
- **自动文件分段**：在开始启航倒计时和通过终点线时自动分段，便于按轮次组织数据
- 统一 session 模型，支持后端复盘
- 记录 active\_scene / target\_id / rounding\_side                                                         

---

## 5. 航向融合（Heading & Confidence）

### 5.1 设计原则

- 主航向以 **磁罗盘（magnetometer）** 为核心：静止时必须像真正罗经
- GNSS 的 COG **不是主航向**：仅用于对地几何计算与crab/drift（对地蟹行/漂移）指标
- 输出 **confidence** 与 **磁干扰提示**（用户需要知道什么时候不可信）

### 5.2 EVT 融合策略（无风设备版）

- **Heading（主输出）**：tilt-compensated magnetometer + IMU 姿态补偿
- **COG（辅助）**：来自 GNSS；仅用于：
  - 起航/冲线/对标的几何计算（VMG\_mark、到线垂距、TTL 等）
  - 迎风场景的“crab/drift”监测（见 5.3）
- **不做**：用 COG 去校正磁航向（避免在海流/低速/漂航时引入错误）

### 5.3 迎风 Crab/Drift（对地蟹行/漂移）数据与报警（可选）

> 说明：在没有 STW（对水航速）与无流数据的前提下，无法从逻辑上区分 **海流** 与 **leeway（侧滑）** 的贡献。本指标仅输出 **对地 crab/drift**（COG 与 Heading 的差异），由水手结合体感/环境自行判断；报警为可选。

#### 5.3.1 指标定义

- **Drift Angle（漂移角）**：
  - `drift_deg = wrap180(COG - Heading)`
- **Lateral Speed（横移速度）**：
  - `v_lat = SOG × sin(drift)`（SOG 需换算为 m/s 或 kn，保持一致）
- **Forward Speed（前进分量）**：
  - `v_fwd = SOG × cos(drift)`

#### 5.3.2 启用条件（建议）

- `SOG > 1.0 kn`（低速不稳定，避免噪声）
- `Heading confidence >= 60%`（示例阈值）
- `active_scene ∈ {Upwind Mark, Upwind Finish}`（仅在迎风场景默认展示）

#### 5.3.3 报警逻辑（可选，EVT 可关）

- `SOG > 1.0 kn`（低速不稳定，避免误报警）

- `Heading confidence >= 60%`（示例阈值）

- `active_scene ∈ {Upwind Mark, Upwind Finish}`（仅在迎风场景启用）

- **Drift Angle 超阈值**：`|drift_deg| > 12°` 持续 3s → 提示 `CRAB ALERT`

- **横移速度超阈值**：`|v_lat| > 0.8 kn` 持续 3s → 提示 `CRAB HIGH`

#### 5.3.4 UI 表达（建议）

- 小字显示：`DRIFT +14°`（+ 右舷 / − 左舷）
- 或显示：`LAT 0.9 kn`

> 注意：该提示仅表示“对地航迹与船首方向差异过大”。原因可能是：海流、侧风、帆形、舵量、操纵等；设备不做归因。

## 6. 赛场数据结构（Course Model）

### 6.1 实体定义

- **Start Line**: Pin(P) + Boat(B)
- **Finish Line**: FinishPin(FP) + FinishBoat(FB)
- **Marks**:
  - WM（windward mark）
  - LM（leeward mark）
- **Waypoint**：用户自由打点

### 6.2 绕标方向（Rounding Side）

- 每个 Mark 必须带：`rounding_side ∈ {PORT, STARBOARD}`
- Fleet 与 Match 可能不同：
  - **影响：仅影响最后进标引导**（KEEP MARK TO PORT/STBD、entry side ok/wrong）
  - **不影响** DTG/BRG/VMG 等通用指标

### 6.3 赛场标定（Course Calibration）主流策略（无风设备版）

> 目标：在 GNSS 抖动、船无法“贴到航标/启航船”的现实约束下，得到**稳定可用**的线/点几何。

#### 6.3.1 起航线/终点线（Line）

**A) 双端附近采样（主流）**

- 到 Pin 附近（例如 10–30m 内）进入 `Set Pin`，持续 **10–20s 采样**（5–10Hz），取 **中位数/截尾均值** 作为端点。
- Boat 端同理。
- 给出 `Line Quality`（采样散布半径：Good/Ok/Poor）。

**B) 沿线航行拟合（增强模式，推荐作为可选）**

- 进入 `Fit Line` 模式后沿起航线附近航行一段（或穿越一端到另一端）。
- 对采样点做直线拟合（最小二乘/RANSAC），得到**线的方向**；
- 线段端点用“最靠近两端的点”或用户补打端点。

> 直觉：起航线只要“那一条线”稳定即可，端点各偏几米通常不致命。

#### 6.3.2 航标（Mark）

**A) 靠近航标采样（主流）**

- 进入 `Set Mark` 后，在航标附近绕行/掠过，采样 10–20s，取中位数。

**B) 绕标两圈取中心（新策略，推荐）**

- 进入 `Orbit Mark` 模式：保持航标在同一侧，绕 1–2 圈。
- 对轨迹点拟合圆（circle fit），取 **圆心** 作为 Mark 坐标。
- 输出 `Mark Quality`：拟合残差（RMS）+ 圆半径稳定性。

**为何有效**

- 轨迹围绕航标形成“环”，圆心估计天然抵抗 GNSS 噪声；
- 不要求船贴近航标本体。

**注意事项**

- 海流/侧滑会让轨迹不是完美圆：用 RANSAC/截尾拟合可稳住；
- 航标可能会随浪/流轻微漂移：两圈时间不要太长（30–90s 级别）。

---

## 7. VMG 模块（VMG Module）（VMG Module）

### 7.1 VMG 类型与公式

#### VMG to Mark（默认）

```
VMG_mark = SOG × cos(COG − BRG_to_target)
```

- 无需风
- 任意航段可用

### 7.2 稳定策略

- SOG 做 2–3s 平滑
- SOG < 阈值：VMG/TTL 显示 `--` 或 LOW SPEED
- UI 标注：`SOG-based`

---

## 8. 起航模块（Start Module）

### 8.1 通用前提：起航线

- Start line = Pin(P) + Boat(B)
- 设置方式：进入 **Settings / Calibration** 页面完成 `Set Pin` 与 `Set Boat`（见 10A 与 6.3）
- 起航页面不承担“打点标定”职责，避免比赛中误操作

### 8.2 Fleet Start（集体起航）

**P0 功能**

- **可配置的倒计时时间**：支持任意分钟数设置（默认 5min）
- **等待/设置状态**：在按下开始前，显示预设时间并允许调整
- **倒计时秒级校正**：比赛中允许 ±1s 微调
- **SYNC**：对齐到整分钟
- **到线垂距**（signed distance）→ OCS 风险
- **TTL**（time to line）/ **Burn/Late**

**关键 UI 指标**

- **等待状态**：`READY: 5:00`（显示预设时间，未开始，默认 5min）
- **倒计时中**：
  - **Heading（航向）**：大号显示，用于指向控制
  - **当前 SOG（航速）**：大号显示
  - `T-01:23`（倒计时）
  - `BURN +12s` / `LATE 8s`
  - `LINE -18m`（负=在线后）

### 8.3 Match Start（对抗赛，标准 Box 起航）

> 说明：Match 起航中，设备的价值在于 **时间管理 + 姿态感知 + 航速控制**，感知对手是选手的活。

#### 8.3.1 两步设置模式

Match Start 采用两步设置，简化配置：

1. **倒计时开始时间**（默认 5min）：从按下开始到起航信号的总时长
2. **进 Box 时间**（默认 4min）：倒计时剩余多少时间时进入 Box 区（例如：T‑4:00 时进 Box）

**示例流程（默认 5min/4min）**
- **T‑5:00**：按下开始，倒计时启动
- **T‑4:00**：进入 Box 区提示（Box Entry）
- **T‑0:00**：起航信号（Start）

**自定义示例（6min/2min）**
- **T‑6:00**：按下开始，倒计时启动
- **T‑2:00**：进入 Box 区提示（Box Entry）
- **T‑0:00**：起航信号（Start）

#### 8.3.2 起航流程阶段

- **T‑开始时间 \~ T‑进Box时间**：进入 Box 区准备
- **T‑进Box时间 \~ T‑2:00**：Dial‑up（控制航速、保持可操作性）
- **T‑2:00 \~ T‑1:00**：保持位置与速度
- **T‑1:00 \~ Start**：冲刺（Acceleration to line）

#### 8.3.3 核心显示指标（P0）

**进 Box 前（T‑开始时间 \~ T‑进Box时间）**
- **主倒计时**（T‑mm\:ss）：显示到起航信号的时间
- **Box 倒计时**：显示到进 Box 时间点（例如：`BOX in 0:23`）
- **倒计时秒级校正**：比赛中允许 ±1s 微调
- **进 Box 时间点的 Burn/Late**：显示到进 Box 时间点的提前/延迟（例如：`BOX BURN +8s` / `BOX LATE 3s`）

**进 Box 后到启航前（T‑进Box时间 \~ T‑0:00）**
- **复用 Fleet 启航模式显示**：与 Fleet Start 相同的指标布局
  - **Heading（航向）**：大号显示，用于指向控制
  - **当前 SOG（航速）**：大号显示，用于 Dial‑up / 冲刺
  - **主倒计时**（T‑mm\:ss）：显示到起航信号的时间
  - **到线垂距**（signed distance）
  - **起航时间点的 Burn/Late**：显示到起航信号的提前/延迟（例如：`BURN +12s` / `LATE 8s`）
  - **TTL**（time to line）
- **Box 状态提示**：是否已进入 Box 区（基于到线距离阈值，例如：`BOX: IN` / `BOX: OUT`）

> **重要**：进 Box 和起航同样重要，都需要精确的时间管理。进 Box 后，设备复用 Fleet 启航模式的完整显示（Heading、SOG、到线垂距、Burn/Late），确保在 Box 区内的精确操控。

#### 8.3.4 Box 区逻辑（EVT 简化版）

- Box 区作为**软约束**：
  - 设备提示是否已进入 Box（基于到线距离阈值，例如 2 倍船长度）
  - **不强制绘制 Box 边界**（避免复杂规则差异）
- 当倒计时到达"进 Box 时间"时，UI 显示 Box 状态提示（例如：`BOX: IN` / `BOX: OUT`）
- Box 状态提示持续显示直到起航信号

#### 8.3.5 不在 EVT 范围内（明确）

- 不要求对手位置输入
- 不要求实时控制权判断
- 不要求 Penalty / Umpire 规则判断

---

## 9. 航段闭环场景模块（4 Scenarios）

> 目标：与 Start 形成闭环：Start → UpwindMark → DownwindMark → Finish

### 9.1 场景模块总表

| Scene           | 目标          | 核心指标（P0）                         | 进阶（P1） |
| --------------- | ----------- | -------------------------------- | ------ |
| Upwind Mark     | WM          | DTG/BRG/VMG\_mark/ETA            | -      |
| Downwind Mark   | LM          | DTG/BRG/VMG\_mark/ETA            | -      |
| Upwind Finish   | Finish line | LINE signed dist、TTL、Angle error | -      |
| Downwind Finish | Finish line | LINE signed dist、TTL、Angle error | -      |

### 9.2 迎风对标（Upwind Mark Approach）

**Inputs**: WM + rounding\_side + GNSS（可选 TWD）

**Outputs P0**

- DTG, BRG
- VMG\_mark
- ETA



**绕标侧引导**

- DTG < 150m：显示 `KEEP MARK TO PORT/STBD`
- 可选：Entry side OK/WRONG

### 9.3 顺风对标（Downwind Mark Approach）

同迎风对标，区别：

- 顺风阶段仅使用 VMG\_mark（基于目标点）
- 绕标侧同样由 LM.rounding\_side 控制

### 9.4 迎风冲线（Upwind Finish Line）

**Inputs**: Finish line（FP/FB）+ GNSS

**Outputs**

- LINE signed distance（>0 OCS/已过线）
- TTL
- Angle error（冲线角度偏差）

### 9.5 顺风冲线（Downwind Finish Line）

同迎风冲线，强调 Angle error（避免跑斜/蛇形过大）

---

## 10. UI 与交互（E‑ink 适配）

### 10.1 页面集合（Pages）

1. Compass（默认）
2. Start（Fleet/Match）（群发赛/对抗赛启航，整合等待/设置与倒计时）
3. Course/Mark（Upwind/Downwind mark）（迎风/顺风绕标）
4. Finish（Upwind/Downwind finish）（迎风/顺风冲终点）
5. Settings/Calibration（设置）

### 10.2 刷新策略（建议）

- 大数字：1–2Hz 局刷（看屏幕能力）
- 倒计时：1Hz
- 其余信息：0.5–1Hz
- 尽量避免频繁全刷

### 10.3 自动切换策略（EVT：自动为主，支持手动覆盖）

> 目标：尽量“自动切换页面”，让水手在比赛中无需频繁按键；同时保留 PAGE 手动覆盖作为兜底。

- 默认：**Auto Scene Mode = ON**
- PAGE：仍可手动切换页面；手动切换后进入 **Manual Override**（例如 30s）
  - Override 期间不自动跳页
  - 超时后自动回到当前应处的场景页面
- 关键切换全部采用 **门限 + 滞回 + 最小持续时间**，避免 GNSS 抖动导致反复跳转

---

## 10B. 自动场景切换状态机（Start → Legs → Finish → Wait）

### 10B.1 页面/状态定义

- **START（起航页面）**：整合等待/设置与倒计时状态
  - **START\_WAIT**：等待状态，显示预设时间，允许调整序列
  - **START\_ACTIVE**：倒计时运行中（Fleet/Match）
- **UPWIND\_MARK（迎风对标）**：目标 WM（或 Offset）
- **DOWNWIND\_MARK（顺风对标）**：目标 LM（单标或门标）
- **UPWIND\_FINISH（迎风冲线）**：目标 Finish line
- **DOWNWIND\_FINISH（顺风冲线）**：目标 Finish line

> 注：UP/DOWN "Finish" 只是 UI 语义；底层仍复用同一套"到线/TTL/角度偏差"计算。

### 10B.2 用户输入（赛前配置）

为保证自动切换可靠，EVT 要求赛前在 Settings 中选择一个 **Course Template**：

- `CourseType = W-L`（上风标 → 下风标）
- `FinishAfter = Upwind | Downwind`（终点在迎风还是顺风）
- `NumLaps = 1..N`（跑几圈；N=1 最常见）
- `HasOffset = 0/1`（上风标后是否有 Offset 标）
- `LeewardMode = Single | Gate`（下风单标或门标；Gate 需要两点 `LM1/LM2` 或“最近点”策略）

这些是“自动切换能不能做对”的最小信息集，不涉及风。

### 10B.3 自动切换流程（你定义的闭环）

#### 0) WAIT → START\_ACTIVE

- 进入 Start 页面（默认上电即显示 Start 页面，处于**等待/设置状态**）
- **上电即开始数据记录**：设备启动后立即开始写卡，记录所有导航数据
- **短按 ACTION** 后：从预设时间开始倒计时（Fleet 或 Match）
  - **同时触发文件分段**：中断当前文件并保存，创建新文件开始记录本轮比赛数据
  - 记录事件：`EVENT_START_TIMER`
- 倒计时期间允许 **ADJUST ±1s** 做秒级校正（防止起航枪声/显示不同步）
- 在等待状态下，可调整预设时间序列，无需进入 Settings

#### 1) START\_ACTIVE → UPWIND\_MARK

- 触发条件：**通过起航线**（signed distance 发生稳定的符号翻转）
  - `line_dist`：点到起航线的有符号距离（负=在线后，正=越线侧）
  - 条件示例：
    - `line_dist` 从负变正，且持续 `> 2s`
    - `SOG > 1.5 kn`
- 切换后目标设为：`WM`（若 `HasOffset=1`，先进入 `Offset` 子目标，见 10B.5）

#### 2) UPWIND\_MARK（含 Offset）完成后：进入 DOWNWIND 或 DOWNWIND\_FINISH

- 触发条件：**绕标完成事件**（自动判断，见 10B.4）
- 绕完上风标后，根据模板判断：
  - 若 `FinishAfter = Upwind` 且这是最后一段：进入 **UPWIND\_FINISH**
  - 否则：进入 **DOWNWIND\_MARK**

#### 3) DOWNWIND\_MARK 完成后：进入 UPWIND 或 UPWIND\_FINISH

- 触发条件：**绕标完成事件**（自动判断，见 10B.4）
- 绕完下风标后，根据模板判断：
  - 若 `FinishAfter = Downwind` 且这是最后一段：进入 **DOWNWIND\_FINISH**
  - 否则：进入 **UPWIND\_MARK**（进入下一圈）

#### 4) FINISH → START

- 触发条件：**通过终点线**（finish signed distance 稳定符号翻转）
  - 同样用 `finish_line_dist` 符号翻转 + `SOG` 门限 + 持续时间
- 通过后：
  - **触发文件分段**：中断当前文件并保存，创建新文件开始记录下一轮/赛后数据
  - 记录事件：`EVENT_FINISH_CROSS`
  - **直接进入 START 页面（等待状态）**：`START_WAIT`
  - 允许立即按 ACTION 开启下一次计时
  - 无需冷却时间，支持连续多轮比赛

### 10B.4 自动“绕标完成”判定（无风版）

> 目标：在没有风向风速的情况下，仅用 GNSS 轨迹与赛前 `rounding_side` 完成一个“够用且不乱跳”的绕标判定。

建议采用 **两阶段 + 滞回**：

**阶段 A：进标（Approach）锁定**

- 当 `DTG < D_enter`（例如 80m）持续 2s → 进入 `APPROACH_LOCK`

**阶段 B：通过最近点并离开（Pass & Exit）**

- 记录 `DTG_min`（最近距离）
- 当满足以下全部条件 → 认为绕标完成：
  1. `DTG` 先下降到 `DTG_min`，随后上升，且 `DTG > D_exit`（例如 90m）持续 2s
  2. 船对标的方位发生“穿越”变化：`bearing_to_mark` 相对 `COG` 的夹角出现明显翻转（或 `BRG` 相对航向跨过 ±90°）
  3. （可选增强）若已配置 `rounding_side`：在 `DTG < 50m` 区间内，满足“标在指定一侧”的条件占比 > 60%

> 说明：上述判定不追求裁判级规则正确，只追求“不会乱跳 + 大多数情况下自动切到下一段”。

### 10B.5 Offset 与 Gate（门标）处理

#### Offset（上风标后的小偏移标）

- 若 `HasOffset=1`：
  - 状态序列：`UPWIND_MARK(WM) → OFFSET_MARK(OF) → DOWNWIND_MARK`
  - OF 的绕标判定可用更保守参数（更小 D\_enter/D\_exit），且默认 `rounding_side` 继承或单独配置

#### Leeward Gate（下风门标）

- 若 `LeewardMode=Gate` 且有 `LM1/LM2`：
  - 选择策略（EVT 推荐简单可靠）：
    - 当 `DTG(LM1)` 与 `DTG(LM2)` 差异 > 阈值（例如 20m）时，自动锁定更近的那个为本次目标
    - 一旦锁定，在 `DTG < D_enter` 后不再切换（防抖）

### 10B.6 事件记录（给复盘平台）

自动切换必须写日志事件，供复盘平台按段落切片：

- `EVENT_START_TIMER`：开始启航倒计时时记录（**同时触发文件分段**）
- `EVENT_START_CROSS`：通过起航线时记录
- `EVENT_MARK_ROUND (WM/OF/LM, side, dtg_min)`：绕标完成时记录
- `EVENT_FINISH_CROSS`：通过终点线时记录（**同时触发文件分段**）
- `EVENT_WAIT_ENTER/EXIT`：进入/退出等待状态时记录

> **注**：数据记录在设备上电时即开始。`EVENT_START_TIMER` 和 `EVENT_FINISH_CROSS` 不仅是事件标记，也是文件分段的触发点，便于复盘时按轮次组织数据。

---

## 10A. 按钮与交互逻辑（四键 · 无组合键 · 支持长按）

> 设计原则：**用“长按”逻辑区分高频操作与低频/风险操作。更适合单手操作，提升水上盲操准确率。**

### 10A.1 按钮定义（物理）

| 按钮 | 名称 | 简写 | 核心语义 | 设置/菜单语义 |
| -- | -------- | -- | ----------- | ----------- |
| B1 | PAGE     | PG | 页面切换 / 模式入口  | **返回 (Back) / 退出** |
| B2 | ACTION   | AC | 主操作 / 确认       | **确认 (Enter) / 编辑** |
| B3 | ADJUST − | −  | 数值减少 / 选项切换  | **向上 / 减少** |
| B4 | ADJUST + | +  | 数值增加 / 选项切换  | **向下 / 增加** |

### 10A.2 输入模型（Input Model）

- **短按 (Short Press)**：按下并迅速释放 (< 1.0s)。用于高频交互（切页、打点、微调）。
- **长按 (Long Press)**：按下并保持 (> 1.0s)。用于**风险操作**（重置、结束、进入设置）或**快捷入口**。
- **不使用组合键**：避免因按键时序/手套操作导致的误判，避免双手操作的不便。

### 10A.3 全局通用规则（Global Rules）

1.  **Settings 入口**：在任意主页面，**长按 PAGE (B1)** 进入设置菜单。
2.  **返回逻辑**：在设置/子菜单中，**短按 PAGE (B1)** 为返回上一级；**长按 PAGE (B1)** 为直接退出到主页面。
3.  **数值调节**：**短按** B3/B4 为步进（±1）；**长按** B3/B4 为快进（连续调节）。
4.  **屏幕刷新**：为解决墨水屏残影，在 **Compass 页面长按 ACTION (B2)** 触发强制全刷。

### 10A.4 各页面按钮行为一览

#### A) Compass（默认首页）

| 输入 | 行为 | 说明 |
| :--- | :--- | :--- |
| **PG 短按** | 切换到 Start 页面 | 循环翻页：Compass → Start → Mark → Finish |
| **PG 长按** | **进入 Settings** | 全局统一入口 |
| **AC 短按** | 切换次要信息 | 例如切换底部显示：时间 / 速度 / 电量 |
| **AC 长按** | **强制屏幕全刷** | 清除残影 (Clean Screen) |
| **− / +** | 无 | 避免误触 |

#### B) Start – Fleet（群发赛）

**状态：等待/设置（未开始）**

| 输入 | 行为 | 说明 |
| :--- | :--- | :--- |
| **PG 短按** | 切换到 Mark 页面 | |
| **AC 短按** | **START (开始倒计时)** | 从预设时间开始倒计时（默认 5:00 → 4:59...） |
| **AC 长按** | **进入设置模式** | 允许修改预设时间（任意分钟数） |
| **− / + 短按** | 预设时间 ±1min | 调整等待状态的预设时间（默认 5min，可设为任意值） |
| **− / + 长按** | 预设时间快速调节 | 连续调节（长按期间持续增减，支持任意分钟数） |

**状态：倒计时中**

| 输入 | 行为 | 说明 |
| :--- | :--- | :--- |
| **PG 短按** | 切换到 Mark 页面 | 启航后通常自动切，手动为备用 |
| **AC 短按** | **SYNC (同步)** | 向下取整到最近分钟（例 4:58 → 4:00） |
| **AC 长按** | **STOP & RESET** | 停止倒计时并重置回预设时间 |
| **− / + 短按** | 倒计时 ±1s | 秒级校正（防止起航枪声/显示不同步） |
| **− / + 长按** | 倒计时快速调节 | 连续调节（长按期间持续增减） |

#### C) Start – Match（对抗赛）

**状态：等待/设置（未开始）**

| 输入 | 行为 | 说明 |
| :--- | :--- | :--- |
| **PG 短按** | 切换到 Mark 页面 | |
| **AC 短按** | **START (开始倒计时)** | 从预设的开始时间开始倒计时（默认 5:00 → 4:59...） |
| **AC 长按** | **进入设置模式** | 进入两步设置：1) 倒计时开始时间 2) 进 Box 时间 |
| **− / + 短按** | 切换设置项 | 在"开始时间"和"进 Box 时间"间切换（设置模式下） |
| **− / + 长按** | 调整当前设置项 | 连续调节当前选中的时间（开始时间默认 5min，进 Box 时间默认 4min） |

**设置模式说明**：
- 长按 AC 进入设置后，显示当前两个参数：`START: 5:00` / `BOX: 4:00`
- 短按 −/+ 切换要设置的项（高亮显示）
- 长按 −/+ 调整当前高亮项的时间（±1min 步进）

**状态：倒计时中**

| 输入 | 行为 | 说明 |
| :--- | :--- | :--- |
| **PG 短按** | 切换到 Mark 页面 | |
| **AC 短按** | **SYNC (同步)** | 同步到当前时间点（例：听到信号时按，同步到对应时间） |
| **AC 长按** | **STOP & RESET** | 停止倒计时并重置回等待状态 |
| **− / + 短按** | 倒计时 ±1s | 秒级校正（防止信号/显示不同步） |
| **− / + 长按** | 倒计时快速调节 | 连续调节（长按期间持续增减） |

#### D) Upwind / Downwind Mark（航段对标）

| 输入 | 行为 | 说明 |
| :--- | :--- | :--- |
| **PG 短按** | 切换到 Finish 页面 | |
| **AC 短按** | **Confirm Rounding** | 确认绕标完成 → 立即切入下一航段（WM→LM） |
| **AC 长按** | **Mode Override** | 强制切换 自动/手动 模式（解除自动锁定） |
| **− / + 短按** | 切换显示字段 | 循环显示 DTG / VMG / ETA / Time |

#### E) Finish（冲线）

| 输入 | 行为 | 说明 |
| :--- | :--- | :--- |
| **PG 短按** | 切换到 Compass | 准备下一轮 |
| **AC 短按** | **Log Finish** | 记录冲线瞬间（可多次按，记最后一次） |
| **AC 长按** | **手动分段** | **手动触发文件分段**（中断当前文件并保存，创建新文件继续记录，用于特殊情况） |

### 10A.5 设置菜单交互 (Settings Navigation)

进入方式：**长按 PAGE (B1)**

| 输入 | 行为 | 说明 |
| :--- | :--- | :--- |
| **PG 短按** | **BACK (返回)** | 返回上一级菜单；若在根目录则退出 |
| **AC 短按** | **ENTER (进入/编辑)** | 进入子菜单 / 选中条目 / 切换开关 |
| **AC 长按** | **SAVE & EXIT** | 针对数值编辑：保存修改并退回上一级 |
| **− / +** | **UP / DOWN** | 菜单滚动 / 数值增减 |

#### 典型操作流示例：标定起航线 (Set Pin)

1.  **长按 PG** 进入 Settings。
2.  **短按 −/+** 滚动到 `Calibration`，**短按 AC** 进入。
3.  **短按 −/+** 滚动到 `Set Pin`，**短按 AC** 触发采样（界面显示 Sampling...）。
4.  采样完成后自动返回，或 **短按 PG** 取消/返回。
5.  **长按 PG** 退出 Settings 回到主界面。

### 10A.6 设计优势

1.  **零学习成本**：符合主流运动手表（Garmin/Coros）逻辑（左键菜单/返回，右键确认/操作）。
2.  **防误触**：重置、结束记录等“破坏性”操作必须长按，水上碰撞不易触发。
3.  **操作清晰**：去掉了“同时按两个键”的杂技动作，单指即可完成所有操作。

## 11. 数据记录 (Logging)（Logging）

### 11.1 记录字段（建议）

```
timestamp
lat, lon
sog, cog
heading
roll, pitch
yaw_rate
heading_confidence
gnss_fix, sat_count
active_scene
race_mode (fleet/match)
target_id (WM/LM/FINISH)
rounding_side (when applicable)
```

### 11.2 写入策略

- RAM ring buffer
- 1–2s 批量写入（减少 SD 卡阻塞）
- UI/融合任务优先级高于 logger

### 11.3 文件分段策略（Session/File Segmentation）

**设计原则**：上电即开始记录，在关键节点自动分段，确保数据完整且便于复盘。

**文件分段触发点**：

1. **上电启动**：设备上电后立即开始写第一个文件
2. **开始启航倒计时**：在 Start 页面短按 ACTION 开始倒计时时
   - 中断当前文件，关闭并保存
   - 创建新文件，开始记录本轮比赛数据
   - 记录事件：`EVENT_START_TIMER`
3. **通过终点线**：自动检测到通过终点线时
   - 中断当前文件，关闭并保存
   - 创建新文件，开始记录下一轮/赛后数据
   - 记录事件：`EVENT_FINISH_CROSS`

**文件命名建议**：
- 格式：`YYYYMMDD_HHMMSS_<session_id>.log`
- 或：`session_<timestamp>_<sequence>.log`
- 每个文件包含完整的起航→航段→终点数据

**优势**：
- **数据完整**：上电即记录，不遗漏任何数据
- **自然断点**：起航和终点是复盘的关键节点，自动分段便于按轮次组织
- **无需手动管理**：自动分段，减少用户操作负担

---

## 12. 固件架构（Firmware Architecture）

### 12.1 FreeRTOS 任务划分（建议频率）

| Task         | 内容           | 频率             |
| ------------ | ------------ | -------------- |
| imu\_task    | BMI160 采样    | 200–400Hz      |
| gnss\_task   | UBX 解析       | 5–10Hz         |
| fusion\_task | 姿态/航向融合      | 50–100Hz       |
| ui\_task     | 渲染与局刷节流      | 1–5Hz          |
| logger\_task | 批量写入         | 0.5–1Hz（batch） |
| ble\_task    | （可选）BLE/调试通讯 | 1Hz            |

---

## 13. 校准与验证计划（EVT Test Plan）

### 13.1 室内（Bench）

- IMU 噪声与稳定性
- Heading 漂移/抖动
- 墨水屏局刷残影/闪烁可读性
- 功耗（待机/记录/无线）

### 13.2 磁环境（如果带磁力计）

- 8 字校准（hard/soft iron）
- 不同安装位置对比
- 磁干扰强度提示可用性

### 13.3 户外/水上

- 静止航向稳定性
- 转向响应（延迟/过冲）
- Fleet 起航：Burn/Late 体感一致
- **Match 起航：4min Box 流程可顺利执行，航速显示对 Dial‑up / 冲刺有帮助**
- Mark/Finish 场景：DTG/VMG/LINE 指标连续可用
- Mark/Finish 场景：DTG/VMG/LINE 指标连续可用

---

## 14. 范围边界（Not in EVT）

- 自动风场重建（wind field reconstruction）
- 极曲线/性能模型（polar-based performance）
- AI 战术结论（自动教练）
- 原生 iOS/Android 深度整合

---

## 15. 一句话总结

> **EVT 不是“做多”，而是把竞赛中最关键的闭环做得可信、好用、可记录、可复盘。**

