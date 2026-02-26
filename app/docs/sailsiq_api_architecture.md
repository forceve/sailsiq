# SailSIQ API 架构设计 (MVP)

> 本文档定义了 SailSIQ MVP 阶段的后端 API 接口规范与数据模型。
> 
> **设计原则**：
> *   遵循 **RESTful** 风格。
> *   数据传输格式为 **JSON**。
> *   MVP 阶段优先支持核心复盘流程，部分复杂计算（如风场重建）暂不包含。

---

## 1. 基础信息 (General)

*   **Base URL**: `/api/v1`
*   **Authentication**: Bearer Token (MVP 阶段可选，视是否强制登录而定)
*   **Date Format**: ISO 8601 (`YYYY-MM-DDTHH:mm:ssZ`)

---

## 2. 接口定义 (Endpoints)

### 2.1 P0 核心功能 (MVP Must-Have)

#### A) 场次管理 (Sessions)
管理用户的航行记录元数据。

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **GET** | `/sessions` | 获取场次列表 | `?page=1&limit=20&search=...` |
| **POST** | `/sessions` | 创建新场次 (元数据) | `{ name, date, location, boatType, projectId }` |
| **GET** | `/sessions/:id` | 获取场次详情 | - |
| **PUT** | `/sessions/:id` | 更新场次信息 | `{ name, location, boatType, ... }` |
| **DELETE**| `/sessions/:id` | 删除场次 | - |

#### B) 轨迹数据 (Track Data)
处理高密度的轨迹点数据。

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **GET** | `/sessions/:id/track` | 获取完整轨迹点 | `?simplify=true` (可选：是否抽稀) |
| **POST** | `/sessions/:id/track` | 上传/更新轨迹数据 | `{ points: [ {time, lat, lon, ...} ] }` |
| **GET** | `/sessions/:id/stats` | 获取统计摘要 | - |

#### C) 标注与航标 (Annotations & Marks)
管理复盘过程中的教学标注。

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **GET** | `/sessions/:id/events` | 获取事件列表 | - |
| **POST** | `/sessions/:id/events` | 添加事件 | `{ timestamp, type, note, snapshotUrl }` |
| **PUT** | `/sessions/:id/events/:eid` | 更新事件 | `{ note, type }` |
| **DELETE**| `/sessions/:id/events/:eid` | 删除事件 | - |
| **GET** | `/sessions/:id/marks` | 获取航标列表 | - |
| **POST** | `/sessions/:id/marks` | 添加/更新航标 | `{ type, lat, lon, name }` |

#### D) 导入与解析 (Import & Parsing)
处理文件上传与解析。

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **POST** | `/parser/preview` | 上传文件并获取预览数据 (不存库) | `Multipart/form-data` (file: .gpx/.bin) |
| **POST** | `/sessions/import` | 导入文件并直接创建 Session | `Multipart/form-data` (file, metadata) |

#### E) 导出与分享 (Export & Share)

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **POST** | `/sessions/:id/share` | 生成分享链接 | `{ readOnly: true, expire: ... }` |
| **POST** | `/sessions/:id/export/pdf` | 请求生成 PDF 报告 | `{ includeEvents: true, ... }` |
| **POST** | `/sessions/:id/export/video-assets` | 请求生成视频叠加组件 | `{ format: "mp4", components: [...] }` |

---

### 2.2 P1 增强功能 (Experience Boost)

#### H) 自动标红 (Auto Highlights)

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **POST** | `/sessions/:id/analysis/auto-detect` | 触发自动问题点检测 | `{ rules: ["speed_drop", "turn_event"] }` |
| **GET** | `/sessions/:id/analysis/markers` | 获取系统生成的疑似问题点 | - |
| **POST** | `/sessions/:id/analysis/verify` | 教练确认/否决问题点 | `{ markerId, action: "confirm" | "reject", reason, comment }` |

#### I) A/B 对比 (Compare)

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **GET** | `/sessions/compare` | 获取多个 Session 的对比数据 | `?ids=id1,id2` |

#### K) 视频辅助 (Video Overlay)

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **POST** | `/sessions/:id/video/link` | 关联外部视频链接 | `{ videoUrl, offsetTime }` |
| **POST** | `/sessions/:id/video/sync` | 更新视频与轨迹的同步偏移 | `{ offsetMs }` |

#### J) 课程胶囊 (Lesson Capsule)

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **POST** | `/sessions/:id/capsules` | 创建课程胶囊 | `{ title, selectedEventIds: [...] }` |
| **GET** | `/capsules/:id` | 获取胶囊详情 (用于播放) | - |

---

### 2.3 P2 技术壁垒 (Advanced Tech)

#### 战术语义与风场 (Tactical & Wind)

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **POST** | `/sessions/:id/wind/reconstruct` | 请求风场重建计算 | `{ usePolars: true }` |
| **GET** | `/sessions/:id/wind/field` | 获取重建后的风场数据 | - |

#### 团队协作 (Team Workspace)

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| **GET** | `/teams/:teamId/sessions` | 获取团队场次列表 | - |
| **POST** | `/sessions/:id/comments` | 添加团队评论 | `{ content, replyTo }` |

---

## 3. 数据模型 (Data Models / Schema)

### 3.1 Session (场次元数据)

```typescript
interface Session {
  id: string;
  userId: string;
  projectId?: string; // 可选，所属项目
  
  name: string;       // 场次名称
  date: string;       // 航行日期 (ISO 8601)
  location: string;   // 地点
  boatType?: string;  // 船型
  teamName?: string;  // 队伍名称
  
  // 统计摘要 (缓存字段，避免每次重算)
  stats: {
    duration: number; // 秒
    distance: number; // 米
    maxSpeed: number; // knots
    avgSpeed: number; // knots
    turnCount: number;
  };

  createdAt: string;
  updatedAt: string;
}
```

### 3.2 TrackPoint (轨迹点)

最核心的高频数据。

```typescript
interface TrackPoint {
  t: number;      // Timestamp (Unix timestamp in ms)
  lat: number;    // Latitude
  lon: number;    // Longitude
  
  // 派生或传感器数据 (可为空)
  s?: number;     // Speed (SOG) - knots
  h?: number;     // Heading (COG/HDG) - degrees
  w_s?: number;   // Wind Speed - knots (Global or Local)
  w_d?: number;   // Wind Direction - degrees
}
```

### 3.3 Event (事件标注)

```typescript
interface Event {
  id: string;
  sessionId: string;
  
  timestamp: number; // 对应的时间轴时间点
  type: 'general' | 'tack' | 'gybe' | 'start' | 'mark_rounding' | 'finish';
  note: string;      // 用户备注
  
  snapshotUrl?: string; // 截图 URL (可选)
  autoDetected: boolean; // 是否为系统自动识别 (P1)
  verified: boolean;     // 教练是否确认 (P1)
}
```

### 3.4 Mark (航标)

```typescript
interface Mark {
  id: string;
  sessionId: string;
  
  type: 'start_pin' | 'start_boat' | 'mark' | 'gate' | 'finish';
  name?: string;
  
  lat: number;
  lon: number;
}
```

---

## 4. 错误处理 (Error Handling)

标准错误响应格式：

```json
{
  "error": {
    "code": "FILE_PARSE_ERROR",
    "message": "The uploaded GPX file is corrupted or missing timestamp data.",
    "details": { ... }
  }
}
```

**常用错误码**:
*   `400 Bad Request`: 参数错误 / 文件格式不支持
*   `401 Unauthorized`: 未登录
*   `403 Forbidden`: 无权访问该 Session
*   `404 Not Found`: 资源不存在
*   `422 Unprocessable Entity`: 业务逻辑校验失败 (如：结束时间早于开始时间)
