# SailSIQ 复盘/教学平台（数字产品线）MVP 设计总纲

> 适用阶段：你准备开始设计 **MVP 版本 App**（浏览器/桌面/安卓优先，iOS 暂不考虑）。
>
> 核心目标：用最小代价验证 **“有人愿意用 + 愿意付费/升级硬件”**，同时从 Day 1 埋下技术壁垒（数据质量 + 语义标签飞轮）。

---

## 0. 一句话定位（Positioning）

* **中文**：SailSIQ 不是“轨迹播放器”，而是把一次航行变成“可讲的课”的复盘/教学平台。
* **EN**: SailSIQ turns sailing sessions into teachable tactical lessons, not just replays.

---

## 1. 用户与场景（Users & Use cases）

### 1.1 目标用户

* 教练（Coach）⭐：需要快速产出复盘内容、讲课素材、可分享链接
* 竞赛/训练队员（Sailor）：想知道自己哪里亏、怎么改
* 俱乐部/训练营管理员（Club/Admin）：想沉淀课程、统一训练流程

### 1.2 MVP 聚焦场景（必须能打通）

* 赛后复盘：导入一次航行 → 回放 → 标注关键节点 → 导出/分享
* 课堂/讲解：地图+航迹+航标+风箭头 → 跟随时间讲述战术

> 非 MVP 场景：高精度帆船动力学、全自动战术结论、复杂风场连续插值

---

## 2. 功能拆解与优先级（P0 / P1 / P2）

### 2.1 P0（MVP 必须有：能复盘、能教学、能分享）

#### A) Session 体系（Project / Session）

* 新建项目 Project（可选）：用于组织多个 Session
* Session（一次航行）基本信息：名称、日期、地点（可自动填）、船型/队伍（可选）

#### B) 导入（Import）

* **GPX-only** 作为 MVP 入口：导入 .gpx
* 解析最小字段：`time, lat, lon`（可推导 speed/heading）
* 允许缺失字段：UI 清晰显示 N/A，不阻塞使用

#### C) 地图画板 v1（Canvas v1）

* 底图：矢量/卫星切换
* 航迹：轨迹线（polyline），支持渐进绘制
* 航标/航点 Marks：添加/拖拽/命名（Start/Mark/Finish）
* 风（最简）：全局风向/风速（手动输入即可）+ 风箭头显示

#### D) 回放（Replay）

* 播放/暂停
* 倍速：0.5x / 1x / 2x / 4x / 8x
* 时间轴 scrubber：拖动跳转
* 回放同步：船位点移动、轨迹推进

#### E) 图表与统计 v1（Charts & Stats）

* 最少 2–3 个图：

  * Speed（SOG 估算/设备提供）
  * Heading/Course（相邻点方位角）
  * Turn rate（可选）
* 关键统计卡片：

  * Duration / Distance / Avg speed / Max speed
  * Turn count（粗略：转向次数）
* 图表联动回放：点击曲线 → 时间轴跳转 ⭐

#### F) 标注（Annotations）⭐ 教学核心

* 时间轴事件点 Event marker：文本备注
* 一键截图 Snapshot（画板当前状态）
* 事件列表：可跳转定位

#### G) 导出与分享（Export / Share）

* 分享链接（只读 view）或导出 PDF（最简版也行）

---

### 2.2 P1（体验加分：提升“教练效率”，但不阻塞 MVP）

#### H) 自动标红（Auto highlights v0.1）

* **路径速度渲染（Speed gradient track）**：

  * 轨迹按 `speed` 映射为渐变色（低速→高速），回放时同步“走色/渐进绘制”
  * 可选：在图例中显示 min/avg/max speed（或分位数）
* **疑似问题点标注（Timeline markers）**：

  * 系统自动生成“疑似问题点”（marker）并标在时间轴上（可过滤/可一键隐藏）
  * 点击 marker：时间轴跳转 + 地图定位到对应点（可高亮 5–15 秒窗口）
* **MVP 级检测规则（启发式即可）**：

  * 速度骤降（speed drop）：短窗口内 speed 明显下滑（建议用相对阈值/分位数，不写死绝对值）
  * 转向事件（turn event）：heading 变化幅度或 turn rate 峰值明显
  * 可能的 tack/gybe（可选）：在“转向事件”基础上按角度范围粗分（不给战术结论）
* **输出原则：置信度 + 不下结论**：

  * 只说“这里可能值得看”，不自动判定对错/原因
  * 教练可对 marker：确认/否决（可选）+ 选择原因（rudder/timing/wind/route/other）
  * 系统保存修正，用于后续提升规则/模型（形成标签飞轮）

#### I) A/B 对比（Compare）

* 同一 Session：两条片段对比
* 或两个 Session：轨迹叠加对比

#### J) Lesson Capsule（课程胶囊）⭐ 超高性价比卖点

* 从事件点选 3–8 个
* 自动生成可滑动故事流：截图 + 关键数据 + 解释文本

#### K) 视频辅助模式（Video Overlay Mode）

* **多视频类型支持**：

  * 支持导入 **普通平面视频** 与 **360° 全景视频**（如运动相机/头盔相机）
  * 视频与 Session 时间轴对齐（手动或自动校准）
* **两种显示模式（可切换）**：

  1. **视频叠加模式（Overlay）**：

     * 在视频画面上叠加高对比度数据仪表（速度、航向、时间、关键指标等）
     * 适合沉浸式观看与讲解动作细节
     * 该模式下弱化或隐藏航迹显示，避免干扰视频内容
  2. **分屏对照模式（Split View）**：

     * 页面左右或上下分屏：一侧为视频，另一侧为数据与画板
     * 数据侧显示效果与常规 Canvas 基本一致（航迹、航标、风、时间轴）
     * 适合战术讲解与视频动作的同步对照
* **360° 视频交互（进阶）**：

  * 支持视角拖动/自动跟随（P2 可增强）
  * 不要求在 MVP 阶段做复杂空间标注

---

### 2.3 P2（技术壁垒方向：做强就很难抄）

> P2 的目标：把 SailSIQ 从“轨迹/数据播放器”升级成 **教练可信赖的战术解释系统**。
> 这些能力往往需要长期数据积累与工程打磨，短期难以被复制。

* **硬件日志深度接入（SailSIQ compass/IMU/GNSS）**

  * 接入更高采样率与更全的字段：IMU（加速度/角速度）、磁力计、GNSS（PVT/速度向量）、（可选）气压/温度
  * 时间同步（time sync）：硬件时钟/GNSS 时间对齐，保证“视频/回放/曲线”同一时间基准
  * 原始数据存档（raw archive）：支持从原始帧重放与离线再处理（以后算法升级可回算）
  * 输出更可靠的派生量：更平滑的 heading、turn rate、heel/pitch（若传感器可用）、更稳定的速度估计

* **校准一致性（Calibration pipeline）** ⭐ 数据质量护城河

  * 磁力计校准与抗干扰：软硬铁校准、安装方向补偿、异常场景检测（碳纤维/金属件/电子设备）
  * IMU 标定：零偏/尺度因子/温漂补偿，减少漂移导致的“假事件”
  * 安装姿态与船体坐标系（mounting & frame）：让不同安装位置得到一致指标
  * 质量评分（quality score）：对每个 Session 给出数据可信度，低质量时降级提示（提高教练信任）

* **战术语义引擎（Segmentation + Tactics semantics）** ⭐⭐ 教练脑子的一部分

  * 自动切片（segmentation）：起航段、上风/下风航段、绕标、加速段、等风段等
  * 事件识别（event detection）：tack/gybe、速度损失窗口、过度舵、恢复时间、走神/蛇形等
  * 事件归因（attribution, 先人机协同）：系统给“可能原因候选 + 置信度”，教练一键修正形成标签飞轮
  * 个性化（personalization）：针对船型/队伍/教练风格调整阈值与指标定义（减少误判）

* **风场重建（Wind reconstruction + Confidence）** ⭐⭐ 最硬的技术方向

  * 从航迹/航向/速度（以及硬件姿态/极曲线）估计：全局风向风速、时变风向（header/lift）
  * 分区风（wind zones）：半自动生成风区，教练可拖拽修正；系统记录修正用于学习
  * 置信度输出：明确告诉用户“这段风推断可靠/不可靠”，避免错误结论反噬信任
  * 为战术语义提供底座：让 tack/线路选择/绕标损失的解释更接近真实风况

* **团队协作、权限、评论、作业式教学（Team workflow moat）**

  * Team workspace：教练/队员/管理员权限（查看/评论/编辑/导出/分享）
  * 评论与讨论：在事件点上评论、@队员、形成训练复盘记录
  * 作业式训练：教练布置“看这 5 个事件并回答问题/打标签”，系统收集反馈作为训练数据
  * 内容库：Lesson Capsule 与 Session 版本管理，形成训练营知识沉淀与复用

---

## 3. MVP 信息架构（App IA）

### 3.1 页面清单（Pages）

1. Home / Sessions 列表
2. New Session（创建/导入 GPX）
3. Replay Workspace（核心工作台）

   * Map Canvas
   * Timeline
   * Charts
   * Events panel
4. Export / Share
5. Settings（含 Data & Privacy）

### 3.2 核心工作台布局建议（Workspace layout）

* 左：事件/航标列表（Events & Marks）
* 中：画板地图（Canvas）
* 右：曲线/统计（Charts & Stats）
* 底：时间轴（Timeline）

（桌面/浏览器优先，多面板体验更爽；移动端再做折叠。）

---

## 4. MVP 交互流程（User Flows）

### Flow A：赛后复盘（最重要）

1. 导入 GPX → 自动生成轨迹
2. 手动补充：Start/Marks/Finish + 全局风
3. 播放回放 + 倍速 + 拖时间轴
4. 在关键时刻点“+事件”：写一句话 + 截图
5. 导出 PDF / 生成分享链接

### Flow B：讲课（教练）

1. 打开 Session
2. 选择事件点顺序（或自动）
3. 全屏模式演示（P1/P2）
4. 输出 Lesson Capsule（P1）

---

## 5. 数据模型最小集合（MVP Schema）

### 5.1 实体（Entities）

* User
* Project（可选）
* Session
* TrackPoint
* Mark
* Event
* Snapshot（可选：图片/画布状态）

### 5.2 TrackPoint 最小字段

* `t`（时间戳或相对时间）
* `lat, lon`
* 派生：

  * `speed`（相邻点估算 + 滤波）
  * `heading`（方位角）

### 5.3 Event 字段（为未来飞轮预留）

* `type`（manual / auto_suspect）
* `t_start, t_end`（MVP 可先单点）
* `note`
* `labels`（可选）：good/bad + reason（rudder/timing/wind/route/other）
* `confidence`（自动事件才有）

---

## 6. 轨迹清洗与性能（GPX 也要“看起来专业”）

### 6.1 必做（否则体验会崩）

* 去抖/滤波：速度曲线与位置抖动平滑（简单移动平均或更稳一点的滤波）
* 去掉静止段（港池/停船）：可设置阈值（speed < x 持续 y 秒）
* 轨迹抽稀（简化点数）：保证地图渲染与回放不卡

### 6.2 可选

* 自动识别出航/回航段并隐藏
* 轨迹分段（upwind/downwind）先不做

---

## 7. 数据收集与隐私（Day 1 埋下壁垒）

> 目标：建立数据飞轮，同时不伤害信任。

### 7.1 数据三层（不要“一锅端”）

* Layer A：Raw session data（敏感高）
* Layer B：Derived features（价值高、可匿名）⭐
* Layer C：Labels & corrections（最稀缺壁垒）⭐⭐⭐

### 7.2 模式设计

* Private Mode（默认）：不用于训练
* Improve SailSIQ（opt-in）：导入匿名特征 + 标签修正

### 7.3 MVP 必须提供

* 数据使用开关（Raw/Features/Labels）
* 导出、删除

---

## 8. 开源/闭源边界（推荐路线：Open-core）

### 开源（提升 adoption）

* Canvas / Replay 引擎
* GPX 导入
* 基础图表与标注
* Plugin API

### 闭源（护城河）

* 硬件固件与高质量日志
* 校准一致性管线
* 战术语义引擎
* 风场重建
* 团队协作与云端内容生产

---

## 9. MVP 里“别做”的坑（避免过度工程）

* 高精度帆船动力学/完整 polar 驱动
* 全自动战术结论（教练不信就会反噬）
* 连续风场插值与分区风自动生成（先手动）
* 原生 iOS/Android（先 Web/桌面/安卓 WebView 即可）

---

## 10. 里程碑（Milestones）

### M0：可用的轨迹回放（1 个闭环）

* GPX 导入 → 轨迹 → 回放 → 统计

### M1：可教学（教练能讲课）

* Marks + 手动风 + 事件标注 + 截图

### M2：可分享（传播与转化）

* 分享链接 / PDF
* Lesson Capsule（推荐）

### M3：飞轮启动（壁垒起点）

* 自动标红 v0.1 + 一键修正标签

---

## 11. 设计时的检查清单（你画 UI 时对照）

* [ ] 导入 GPX 后 10 秒内能进入回放
* [ ] 工作台布局清晰：Canvas / Timeline / Charts / Events
* [ ] 图表点击能跳转回放
* [ ] 事件标注极快（≤2 次点击 + 输入）
* [ ] 分享/导出路径不绕
* [ ] 数据隐私默认私有 + opt-in 清晰

---

## 12. 一句话 MVP 指导原则

> **MVP 不追求“自动教练”，只追求“让教练更快讲清楚”。**

做到了这点，你的硬件数据、语义引擎、风场重建都会自然接上。
