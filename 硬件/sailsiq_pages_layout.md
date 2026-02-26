# SailsIQ EVT — 页面段码(ASCII)复刻 + 字段解释

> 说明：下面用 **等宽字符(段码/ASCII wireframe)** 复刻你图里的四个页面：**Compass / Start / Mark / Finish**。每个页面后面按字段逐条解释含义。

---

## 1) Compass 页面

```text
Compass

TOP BAR
FIX   SAT   REC●   TIME   BAT%
----------------------------------------------
| HEADING                                    |
|                 360°                       |
|--------------------------------------------|
| SOG                 | DRIFT                |
| 5.7                 | +25°                 |
----------------------------------------------
```

### 字段解释（Compass）
- **FIX**：GNSS 定位解状态（No Fix / 2D / 3D 等）。用于快速判断 GNSS 是否可靠。
- **SAT**：卫星数量（用于辅助判断 GNSS 质量；通常数值越高越稳定）。
- **REC●**：记录状态指示（亮/点=正在记录到存储；灭=未记录或异常）。
- **TIME**：设备时间（一般来自 GNSS 时间或系统 RTC）。
- **BAT%**：电池电量百分比。
- **HEADING**：罗经航向（船头指向角，0–360°）。这是 Compass 页的核心：即使船静止也可用。
- **SOG**（Speed Over Ground）：对地速度（kn 或 m/s，取决于你的单位设置）。
- **DRIFT**：漂移角（对地航向 COG 与船头航向 Heading 的差，常用 `wrap180(COG-Heading)` 表示，正负号代表偏转方向）。

---

## 2) Start 页面

### 2.1 Ready/设置态（倒计时未运行）
```text
Start (Ready)

TOP BAR
FIX   SAT   REC●   TIME   BAT%
----------------------------------------------
|                READY   5:00                |
|--------------------------------------------|
| SOG                 | LINE                 |
| 3.6                 | -18 m                |
----------------------------------------------
```

### 2.2 倒计时运行态（带 Burn / TTL）
```text
Start (Run)

TOP BAR
FIX   SAT   REC●   TIME   BAT%
----------------------------------------------
|  LATE ->  [  BURN  ]            +12 s       |
|                    T- 00:23                |
|--------------------------------------------|
| SOG                 | LINE   5 m           |
| 3                   | TTL   11 s          |
----------------------------------------------
```

### 字段解释（Start）
- **READY 5:00**：起航倒计时的“准备态”与当前设置的倒计时长度（例：5 分钟）。
- **T- 00:23**：距离起航信号/起航时刻的剩余时间（倒计时运行中）。
- **SOG**：对地速度。用于估算到线时间、以及 Burn/Late 等计算。
- **LINE**：到起航线的**有符号距离**（单位 m）。
  - 常见约定：负值=在线前侧（未越线）；正值=已越线（OCS 风险）——具体符号你可以在实现里固定。
- **BURN**：
  - **概念**：如果保持当前状态（速度/到线距离/倒计时）不变，
  - **你需要“烧掉/消耗”的时间**（例如在起航前到线太早，需要绕行/降速/蛇行消耗）。
  - 显示 `+12s` 通常表示需要消耗 12 秒；若显示为 `LATE` 则表示来不及，需要加速或改策略。
- **LATE**：提示当前预测为“迟到/来不及到线”。
- **TTL**（Time To Line）：预计到起航线的时间（秒）。常用于和倒计时对比。

---

## 3) Mark 页面

```text
Mark

TOP BAR
FIX   SAT   REC●   TIME   BAT%
----------------------------------------------
| HEADING                                    |
|                 114°                       |
|--------------------------------------------|
| SOG                 | VMG   2.1            |
| 5                   | DRIFT -1°           |
----------------------------------------------
DTG 0.42 nm   BRG 32°   ETA 2:11
FOOT BAR
```

### 字段解释（Mark）
- **HEADING**：船头航向。用于操舵参考。
- **SOG**：对地速度。
- **VMG**（Velocity Made Good）：有效速度。
  - 在 Mark 页更推荐理解为 **VMG_to_Mark**：沿着“到目标方向”的速度分量（越大代表越有效地接近目标）。
- **DRIFT**：漂移角（COG 与 Heading 的差）。用于判断侧滑/海流影响（但它无法区分海流 vs leeway）。
- **DTG**（Distance To Go）：到目标点距离（例：0.42 海里）。
- **BRG**（Bearing）：目标方位角（从当前位置指向目标点的方向，0–360°）。
- **ETA**（Estimated Time of Arrival）：预计到达时间（基于距离与有效速度/速度估计）。
- **FOOT BAR**：底部信息槽（你可以用来放：绕标侧提示 `KEEP MARK TO PORT/STBD`、或单位/模式提示等）。

---

## 4) Finish 页面

```text
Finish

TOP BAR
FIX   SAT   REC●   TIME   BAT%
----------------------------------------------
|                 114°                       |
|--------------------------------------------|
| VMG  2.11            | SOG   5.3           |
|                      | DRIFT -1°           |
----------------------------------------------
DTG 0.42 nm   TURNS 0   ETA 2:11
FOOT BAR
```

### 字段解释（Finish）
- **114°（大数字）**：你草图里把大数字作为主航向/参考航向（可理解为 Heading）。
- **VMG**：有效速度（Finish 段通常关注“有效接近终点线/终点点”的速度）。
- **SOG**：对地速度。
- **DRIFT**：漂移角。
- **DTG**：到终点/终点线参考点的距离。
- **TURNS**：转向/绕行计数（你草图里是 0）。
  - 用途可选：统计冲线前的 tack/gybe 次数、或某种策略计数。
- **ETA**：预计到达终点（或终点线）的时间。
- **FOOT BAR**：底部信息槽（可用于：终点线提示、过线/未过线状态、TTL、角度偏差等）。

---

## 字段速查（英文缩写）
- FIX：GNSS Fix status
- SAT：Satellite count
- REC：Recording indicator
- BAT%：Battery percentage
- HEADING：Compass heading
- SOG：Speed Over Ground
- COG：Course Over Ground（本图未直接显示，但常用于 DRIFT/VMG 计算）
- DRIFT：Crab/Drift angle（COG vs Heading）
- VMG：Velocity Made Good（to target/line）
- DTG：Distance To Go
- BRG：Bearing to target
- ETA：Estimated Time of Arrival
- TTL：Time To Line
- BURN：Time to burn (early) / Late indicator
- TURNS：Turn counter (tacks/gybes/strategy counter)
