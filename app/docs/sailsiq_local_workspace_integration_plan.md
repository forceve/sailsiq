# SailSIQ 本地工作空间优先接入方案（当前版本优先实施）

> 本文档用于定义“本地工作空间（Local Workspace）”如何作为优先方案接入当前 SailSIQ 版本。目标不是另起炉灶，而是在现有前后端基础上，以最小破坏方式把产品主工作流切到本地优先。

---

## 1. 背景与结论

### 1.1 背景判断

- 复盘与讲解场景经常发生在网络不稳定环境
- 视频文件、设备日志、导出素材体积大，先上传再使用会明显拖慢体验
- 赛队和个人用户更在意“立即可用、稳定、离线、能处理大文件”
- 机构管理和青少年训练则更强调多人协作、权限、组织沉淀与跨设备访问

### 1.2 服务形态结论

- **本地工作空间**：作为赛队与个人用户的主工作流
- **云服务**：作为机构管理、青少年训练、异地共享、发布与协作的增强层
- **混合模式**：业余赛队平时分散，主编辑在本地，但需要方便地发布到云端共享

### 1.3 当前版本的总原则

- 本地工作空间优先接入当前版本
- 云端 API 保留，但从默认数据层降级为可选适配层
- 当前版本先完成“本地可用闭环”，再补“云同步 / 发布”

---

## 2. 当前版本目标

### 2.1 必须达成

- 用户可以创建或打开一个本地工作空间
- 用户可以把 GPX / bin 导入到本地工作空间
- 用户可以不复制文件，直接绑定本机已有轨迹文件路径
- 用户可以在本地工作空间中浏览 Session 列表
- 用户可以打开 Session 进行回放、标注、航标编辑
- 用户可以把本地视频与 Session 绑定，并保存 offset
- 用户可以直接绑定本机视频路径，而不要求先复制进 Workspace
- 系统可以自动识别 Workspace 内已有轨迹文件、视频文件和标准目录结构
- 用户断网后仍可重新打开工作空间继续使用

### 2.2 应当达成

- 支持将源文件“引用原路径”或“复制到工作空间”
- 支持扫描 Workspace 并自动发现可导入文件和可绑定视频
- 支持工作空间级导出包
- 支持对素材缺失进行检测与重定位

### 2.3 当前版本暂缓

- 真正的多端双向同步
- 完整冲突合并
- 团队级权限系统
- 大文件自动分片上传

---

## 3. 用户场景分层

### 3.1 本地工作空间优先用户

- 赛队
- 个人 sailor
- 现场复盘用户
- 大视频与硬件日志重度用户

### 3.2 云服务优先用户

- 俱乐部
- 学校和青少年训练机构
- 有组织管理和资料沉淀需求的团队

### 3.3 混合模式用户

- 业余赛队
- 不常线下聚集的训练小组
- 这类用户的编辑、整理、对齐过程应在本地完成，但要能快速生成云端共享副本

---

## 4. 产品设计方案

### 4.1 新增一级对象：Workspace

- Workspace 是当前版本的一级对象
- 一个 Workspace 包含多个 Session
- Workspace 同时管理：
  - Session 元数据
  - 轨迹数据
  - 事件标注
  - 航标
  - 视频资产
  - 截图
  - 导出结果

### 4.2 页面与入口调整

#### A) Workspace Setup

- 首次进入应用时优先展示
- 提供 3 个入口：
  - 创建新工作空间
  - 打开已有工作空间
  - 导入工作空间包
- 当前阶段允许先把 Workspace Setup 落在 `Settings` 中，作为 Phase 1 的过渡入口；后续再提升为首次进入应用优先展示
- 当前阶段创建 Workspace 的默认名称定为 `SailSIQWorkspace`
- 当前阶段创建 Workspace 的交互规则定为：
  - 用户先选择“父目录”
  - 系统在父目录下按 Workspace 名称创建一个新的子目录
  - 该子目录作为 Workspace 根目录
- 展示当前环境能力：
  - 本地目录能力可用
  - 仅缓存模式
  - 需要降级到 zip 导入导出

#### B) Workspace Home / Sessions

- 原 Home 页升级为“当前工作空间首页”
- 顶部显示：
  - Workspace 名称
  - 路径
  - 权限状态
  - 最近同步状态
- 列表显示：
  - Session 名称
  - 日期
  - 来源
  - 标注数
  - 素材状态

#### C) New Session

- 增加三种接入方式：
  - 选择文件并复制到 Workspace
  - 选择本机文件并直接引用路径
  - 从 Workspace 已发现文件列表中直接选取
- 增加保存策略：
  - 引用原文件
  - 复制到当前工作空间
- 如果当前 Workspace 中已发现可用轨迹文件，优先展示“快速创建 Session”入口
- 创建 Session 后直接写入当前 Workspace
- 不再把“上传到远端并创建 Session”当作默认路径

#### D) Replay Workspace

- 所有编辑结果默认保存到 Workspace
- 视频支持三种绑定方式：
  - 复制到 Workspace
  - 直接引用本机路径
  - 从 Workspace 已发现视频中选择
- 顶部或工具栏显示：
  - 当前工作空间
  - 保存状态
  - 视频绑定状态
  - 素材缺失提醒

### 4.3 自动识别与路径绑定

#### A) 支持的路径模式

- `workspace_copy`
  - 文件复制到 Workspace 内部，作为推荐的稳定模式
- `workspace_relative_ref`
  - 文件不复制，但位于 Workspace 目录树内部，使用相对路径引用
- `external_absolute_ref`
  - 文件位于 Workspace 外，通过本机路径绑定

#### B) 用户可感知的行为

- 用户不需要理解底层句柄实现
- UI 只需要明确告诉用户：
  - 这个文件已经复制进 Workspace
  - 这个文件是引用 Workspace 内路径
  - 这个文件是引用 Workspace 外路径
- 如果是外部路径，需要明确提示迁移、共享和换机器时可能失效

#### C) 自动识别策略

- 每次打开 Workspace 时执行扫描
- 每次用户手动刷新时重新扫描
- 每次导入新文件、复制文件、绑定新视频后更新索引
- 扫描结果分为：
  - 未建 Session 的轨迹文件
  - 可绑定的视频文件
  - 已失效的路径引用
  - 可疑但未确认的匹配结果

#### D) 自动匹配规则

- 规则 1：同名优先
  - 轨迹文件与视频文件 basename 相同，优先视为同一组素材
- 规则 2：时间接近优先
  - 轨迹起始时间与视频文件创建时间接近时提高匹配置信度
- 规则 3：同目录优先
  - 位于同一 Session 目录或同一导入批次目录中的文件优先关联
- 规则 4：显式绑定优先级最高
  - 一旦用户确认绑定，系统记录 manifest，不再依赖猜测

#### E) 自动识别后的产品表现

- 在 New Session 页面显示：
  - 可直接创建的轨迹文件
  - 系统猜测的关联视频
- 在 Replay 页面显示：
  - 已绑定视频
  - 推荐绑定视频
  - 丢失视频重定位入口
- 在 Workspace Home 显示：
  - 待处理轨迹文件数
  - 待确认视频匹配数
  - 缺失素材警告数

#### E) Export / Share / Publish

- 本地导出优先：
  - PDF
  - Workspace 包
  - Session 包
  - 视频仪表组件
- 云端分享作为主动操作：
  - 发布只读副本
  - 同步到团队空间

#### F) Settings

- 新增工作空间设置区：
  - 默认工作空间
  - 归档策略
  - 权限检查
  - 缓存清理
  - 降级模式说明
- Phase 1 中 `Settings` 需要承载的最低能力包括：
  - Workspace Setup
  - 当前 Workspace 切换
  - 目录权限恢复
  - 手动扫描
  - 浏览器能力与降级提示

---

## 5. 本地工作空间数据结构

### 5.1 推荐目录结构

```text
workspace/
  workspace.json
  incoming/
    track/
    video/
  library/
    source/
    video/
  sessions/
    <sessionId>/
      session.json
      track.json
      events.json
      marks.json
      bindings.json
      assets/
        source/
        video/
        snapshots/
        exports/
  cache/
  index/
```

### 5.1A 目录设计原则

- `incoming/`
  - 用户最容易理解的“待处理入口”
  - 把刚拿到的轨迹和视频丢进来，系统自动扫描识别
- `library/`
  - 存放被多个 Session 复用的共用素材
- `sessions/<sessionId>/`
  - 存放某个 Session 的确定结果与已归档资产
- `index/`
  - 存放扫描缓存、自动识别结果和路径索引

### 5.1B 让用户容易理解的目录规则

- 轨迹文件默认放 `incoming/track/`
- 视频文件默认放 `incoming/video/`
- 被确认归档到某个 Session 后，可进入 `sessions/<sessionId>/assets/...`
- 如果用户不想移动文件，也可以保留在外部路径，但 UI 需要明确这是“外部引用”
- 文档和 UI 都要明确说明：
  - “丢到 incoming 里就能被系统识别”
  - “放进 session 目录里就是这个 Session 的归档资产”

### 5.2 核心元数据

#### `workspace.json`

```json
{
  "id": "ws_001",
  "name": "Spring Training Workspace",
  "version": 1,
  "createdAt": "2026-03-24T00:00:00Z",
  "updatedAt": "2026-03-24T00:00:00Z",
  "sessionsIndex": [],
  "discovery": {
    "lastScanAt": "2026-03-24T00:00:00Z",
    "pendingTracks": [],
    "pendingVideos": [],
    "brokenRefs": []
  }
}
```

#### `session.json`

```json
{
  "id": "sess_001",
  "name": "Morning Practice",
  "date": "2026-03-24",
  "location": "Qingdao",
  "source": "imported",
  "boatType": "ILCA",
  "projectId": null,
  "storageMode": "workspace_copy",
  "stats": {
    "duration": 0,
    "distance": 0,
    "maxSpeed": 0,
    "avgSpeed": 0,
    "turnCount": 0
  },
  "assetRefs": [],
  "createdAt": "2026-03-24T00:00:00Z",
  "updatedAt": "2026-03-24T00:00:00Z"
}
```

### 5.3 AssetRef 规则

- 所有大文件不直接内嵌到主模型
- 统一使用 `assetRefs`
- 最少字段：
  - `id`
  - `kind`
  - `path`
  - `origin`
  - `storageMode`
  - `status`
  - `size`
  - `hash`（可选）

### 5.3A `bindings.json`

- 每个 Session 增加 `bindings.json`
- 用于记录：
  - 轨迹源文件绑定
  - 视频绑定
  - 自动识别置信度
  - 用户确认结果
  - 最近一次重定位信息

示例：

```json
{
  "track": {
    "path": "../../incoming/track/morning.gpx",
    "storageMode": "workspace_relative_ref",
    "confirmed": true
  },
  "videos": [
    {
      "path": "../../incoming/video/morning.mp4",
      "storageMode": "workspace_relative_ref",
      "matchedBy": "same_basename",
      "confidence": 0.92,
      "confirmed": true
    }
  ]
}
```

### 5.4 路径策略

- 工作空间内资产优先使用相对路径
- 外部引用资产保留原路径并记录状态
- 打开 Session 时进行资产可达性检查
- 对外部路径引用，需要保留：
  - 原路径
  - 最近确认时间
  - 最近有效状态
  - 是否允许自动重定位

---

## 6. 技术架构方案

### 6.1 核心原则

- 页面不直接依赖某一种存储方式
- 引入统一 Repository 抽象
- 本地工作空间与云端 API 都实现同一接口

### 6.2 建议抽象层

```ts
interface WorkspaceRepository {
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  openWorkspace(idOrHandle: unknown): Promise<WorkspaceContext>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceContext>;
  scanWorkspace(workspaceId: string): Promise<WorkspaceScanResult>;
  listSessions(workspaceId: string): Promise<SessionSummary[]>;
  getSession(workspaceId: string, sessionId: string): Promise<SessionBundle>;
  saveSession(workspaceId: string, bundle: SessionBundle): Promise<void>;
  deleteSession(workspaceId: string, sessionId: string): Promise<void>;
  importTrackFile(workspaceId: string, file: File, options: ImportOptions): Promise<SessionBundle>;
  bindTrackPath(workspaceId: string, input: PathBindingInput): Promise<SessionBundle>;
  attachAsset(workspaceId: string, sessionId: string, asset: AssetInput): Promise<AssetRef>;
  bindVideoPath(workspaceId: string, sessionId: string, input: PathBindingInput): Promise<AssetRef>;
  discoverAssets(workspaceId: string, sessionId?: string): Promise<DiscoveryResult>;
  relocateBrokenRef(workspaceId: string, refId: string, input: PathBindingInput): Promise<AssetRef>;
}
```

### 6.3 本地适配器

- 名称建议：`localWorkspaceRepository`
- 技术优先级：
  - 第一优先：File System Access API
  - 第二优先：OPFS / IndexedDB
  - 第三优先：Workspace 包导入导出

### 6.4 云端适配器

- 名称建议：`cloudWorkspaceRepository` 或 `publishAdapter`
- 当前版本不作为默认数据源
- 负责：
  - 发布分享
  - 远程备份
  - 可选同步
  - 团队协作入口

### 6.5 解析策略

- 轨迹文件解析尽量前移到本地
- 现有 `shared/trackImport` 解析能力可以复用
- 远端 `/parser/preview` 和 `/sessions/import` 保留，但不再作为默认导入路径

### 6.6 自动扫描与索引策略

- 增加 `workspace scanner`
- 负责扫描：
  - `incoming/track`
  - `incoming/video`
  - `library/video`
  - `sessions/*/assets`
- 负责产出：
  - 可导入轨迹候选
  - 可绑定视频候选
  - 已失效路径引用
  - 建议匹配关系
- 扫描结果缓存到 `index/` 与 `workspace.json.discovery`

---

## 7. 与当前代码的集成设计

### 7.1 当前系统现状

- `app/frtend/src/services/api.ts`
  - 当前页面主要通过这里直接访问远端 API
- `app/frtend/src/pages/NewSessionPage.tsx`
  - 当前导入流程默认走 `/v1/parser/preview` 和 `/v1/sessions/import`
- `app/frtend/src/pages/ReplayWorkspacePage.tsx`
  - 当前视频已支持本地文件选择与 `objectURL` 播放
- `app/frtend/src/types/models.ts`
  - 当前还没有 Workspace、AssetRef、syncState 等模型
- `app/backend/src/index.tsx`
  - 当前承载 Session CRUD、导入解析、视频 URL 关联等远端能力

### 7.2 建议新增模块

- `app/frtend/src/types/workspace.ts`
- `app/frtend/src/services/workspace/repository.ts`
- `app/frtend/src/services/workspace/localWorkspaceRepository.ts`
- `app/frtend/src/services/workspace/cloudWorkspaceRepository.ts`
- `app/frtend/src/services/workspace/workspaceScanner.ts`
- `app/frtend/src/context/WorkspaceContext.tsx`
- `app/frtend/src/utils/workspaceManifest.ts`

### 7.3 现有模块改造建议

#### A) `app/frtend/src/services/api.ts`

- 保留 transport 能力
- 从“页面主数据层”降级为“云端适配器底层”

#### B) `app/frtend/src/pages/NewSessionPage.tsx`

- 新增当前 Workspace 依赖
- 导入时调用 repository，而不是直接调用远端 API
- 新增三种创建入口：
  - 上传并复制到 Workspace
  - 选择本机路径并直接绑定
  - 从 Workspace 已扫描到的轨迹文件中直接创建
- 新增“引用原文件 / 复制到工作空间”选项
- 如果识别到同名或高置信度视频，直接提示用户一并绑定

#### C) `app/frtend/src/pages/ReplayWorkspacePage.tsx`

- 读取 Session 时从 repository 获取 bundle
- 事件、航标、视频 offset 保存时默认落地本地
- 将现有本地视频逻辑抽象为通用资产管理逻辑
- 视频区新增：
  - 绑定本机视频路径
  - 从 Workspace 已识别视频中选择
  - 丢失素材重新定位

#### D) `app/frtend/src/types/models.ts`

- 增加：
  - `Workspace`
  - `WorkspaceSummary`
  - `WorkspaceContext`
  - `AssetRef`
  - `SessionBundle`
  - `SyncState`

#### E) `app/backend/src/index.tsx`

- 当前版本先不删除
- 角色调整为：
  - 可选发布服务
  - 分享服务
  - 云同步服务
  - 未来团队服务入口

---

## 8. 分阶段实施方案

### Phase 0：模型与抽象落地

- 增加 Workspace 与 AssetRef 类型
- 增加 Repository 接口
- 不改业务页面行为，只引入抽象层

### Phase 1：Workspace Setup 与本地基础设施

- 新增 Workspace Setup
- 新增 Workspace Context
- Home 页面切换到当前 Workspace 视角
- 增加 Workspace 扫描入口与发现面板

#### Phase 1 基础设施约束（必须先定死，后续阶段沿用）

- 采用 `filesystem-first` 策略：
  - Workspace 目录中的原始文件与 JSON 元数据文件是真相源
  - 浏览器本地存储不是业务真相源，只承担绑定、缓存与运行时状态职责
- 原始大文件不写入浏览器数据库：
  - GPX / UBX / bin / 视频 / 截图 / 导出物保留在 Workspace 文件系统中
  - 不将这些大文件本体写入 IndexedDB / localStorage
- 浏览器本地持久化职责限定为：
  - `FileSystemDirectoryHandle`
  - 当前 Workspace id
  - 最近使用的 Workspace 列表
  - 权限状态缓存
  - 扫描缓存与发现摘要
  - 少量 UI 运行时状态
- Workspace 目录必须以文件系统目录和 JSON 元数据作为真相源。
- Phase 1 需要稳定落地的元数据范围是：
  - `workspace.json`
  - `workspace.json.discovery`
  - `index/` 中的扫描缓存与发现摘要
- `sessions/<sessionId>/` 下的 `session.json / track.json / events.json / marks.json / bindings.json` 属于后续阶段沿用的数据结构约定：
  - Phase 1 先固定目录与格式约定
  - Phase 2 / Phase 3 再把 New Session 与 Replay 的读写闭环正式接入这些文件
- `bindings.json` 一旦在后续阶段接入，其记录的轨迹绑定、视频绑定、offset、确认状态、匹配来源必须落盘到 Workspace：
  - 不能只保存在浏览器缓存中
- `workspace.json.discovery` 与 `index/` 中的扫描结果属于可重建缓存：
  - 用于提速与推荐
  - 缓存损坏不应导致业务数据丢失
- 浏览器绑定能力建立在稳定 origin 前提上：
  - 正式产品需使用固定域名
  - 开发环境 `localhost` 仅用于调试，不作为长期持久化环境假设
- 目录权限丢失属于正常产品流程，不视为异常路径：
  - 产品必须提供 `Use Workspace / Grant Access / Rebind` 入口
  - 启动时需要检查并恢复目录访问状态
- 浏览器版“打开工作目录”的定义是“恢复并使用该目录访问”：
  - 纯浏览器环境不承诺直接唤起系统文件管理器
  - 若需要系统级“在资源管理器中打开”，由未来桌面版增强支持
- Phase 1 的当前实现约束需要在文档中固定，避免后续开发不一致：
  - `Workspace Setup` 可暂时先落在 `Settings`
  - 默认 Workspace 名称为 `SailSIQWorkspace`
  - 创建方式为“先选父目录，再创建同名子目录作为 Workspace 根目录”
- Phase 1 完成标准补充：
  - 即使 `Home / New Session / Replay` 还未完全切换到本地数据流，也必须先把 Workspace 绑定、恢复、权限、扫描、目录结构初始化这套 infra 做稳定
  - Phase 1 不以“本地 Session 列表”和“本地 Session bundle 写入完成”为验收前提
  - 后续所有阶段都建立在这套 Phase 1 infra 之上，而不是绕过它各自直连远端或各自做一套本地逻辑

### Phase 2：导入写入本地工作空间

- `NewSessionPage` 同时支持两类入口：
  - 直接从当前 Workspace 已发现的轨迹文件中选择，不需要再次打开文件资源管理器
  - 通过文件资源管理器选择 Workspace 外部的本地文件来创建 Session
- 当用户通过 Workspace 外部文件创建 Session 时，需要提供明确的保存策略
  - 例如复选框：是否将该 Session 保存到当前 Workspace
  - 例如复选框：是否将源文件一并复制到当前 Workspace
- 如果用户选择保存到 Workspace，则相关文件自动写入对应目录
  - 轨迹文件进入 `incoming/track`
  - 视频文件进入 `incoming/video`
- 支持创建 `session.json / track.json / events.json / marks.json`
- 支持两种源文件保存策略
- 支持直接绑定轨迹路径
- 支持从 Workspace 已识别轨迹中快速创建 Session
- 当 `Home` 已经暴露本地 Workspace Session 列表后，Replay 至少必须支持“打开并读取”这些本地 bundle
  - 即：进入 Replay 时优先读取 `sessions/<sessionId>/session.json / track.json / events.json / marks.json / bindings.json`
  - 如果当前 Workspace 下不存在该 Session，再回退到远端 API
  - 这个能力的目标是消除 `Session not found` 断层，而不是在 Phase 2 提前完成完整本地写回

### Phase 3：Replay 本地读写闭环

- Replay 的新增、编辑、删除操作默认写回本地 bundle
- 标注、航标、offset 变更写回本地
- 增加保存状态与权限状态展示
- 增加视频路径直接绑定与丢失重定位
- 在 Phase 2 已具备“本地可打开可读取”的前提下，Phase 3 负责把 Replay 从“本地读取兼容”推进到“本地读写闭环”

### Phase 4：视频与素材管理

- 把现有本地视频逻辑升级为 Workspace 资产逻辑
- 支持视频归档、缺失检测、重绑定
- 支持截图和导出物入库
- 增加自动发现和推荐绑定视频

### Phase 5：发布与可选同步

- 保留现有云端 API
- 增加“发布到云端”动作
- 增加只读分享与远程副本能力

---

## 9. 风险与处理方案

### 9.1 浏览器兼容性风险

- 风险：部分浏览器不支持 File System Access API
- 处理：
  - 首选支持环境直接绑定目录
  - 其余环境走 OPFS / zip 降级

### 9.2 目录权限丢失风险

- 风险：浏览器重启后目录权限失效
- 处理：
  - 每次进入时检查权限状态
  - 给出重新绑定入口

### 9.3 大文件复制风险

- 风险：复制视频或原始日志耗时长、占空间大
- 处理：
  - 默认提供两种策略
  - 推荐复制到 Workspace，但允许只引用

### 9.4 本地与云端冲突风险

- 风险：未来同步时出现版本冲突
- 处理：
  - 当前版本避免默认双写
  - 先做本地单主副本
  - 云端只做显式发布或备份

---

## 10. 当前版本验收标准

### 10.1 产品验收

- 用户首次进入时知道需要创建或打开工作空间
- 用户能把一份 GPX / bin 导入到本地工作空间
- 用户能直接绑定本机已有轨迹文件路径创建 Session
- 用户能断网重开并继续使用
- 用户能绑定本地视频并保留同步偏移
- 用户能直接绑定本机视频路径
- 用户把文件放进 Workspace 规范目录后，系统能自动识别并提示可用
- 用户能导出 Session 包或 Workspace 包

### 10.2 技术验收

- 页面不再直接依赖远端 API 作为唯一数据源
- 本地仓储接口可独立工作
- 云端适配器可单独用于发布
- 工作空间目录结构稳定、可重建、可迁移
- 路径绑定、自动扫描、缺失重定位三套机制可独立运行

### 10.3 性能验收

- 中小型 GPX / bin 导入后应快速进入回放
- 本地视频绑定不要求上传完成
- 重新打开本地 Session 不依赖网络

---

## 11. 推荐实施顺序

1. 先补模型与 Repository 抽象
2. 再做 Workspace Setup 和 Home 改造
3. 然后改 New Session 的本地导入闭环
4. 再改 Replay 的本地读写
5. 最后接入素材管理与云发布

---

## 12. 一句话实施策略

> **先把本地工作空间做成当前版本的默认真相源，再把云端能力收敛为发布、协作和组织管理层。**
