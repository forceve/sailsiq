# SailSIQ EVT LVGL UI Spec v1.1 — LCD Edition

> 目的：把产品开发手册、GUI 示意图、页面 ASCII 复刻和复盘平台要求，整理成一份可以直接交给 Cursor / Claude Code / ChatGPT 生成 LVGL 页面代码的工程 spec。  
> 目标：先在 400×300 PC simulator 跑通页面，再移植到 ESP32-S3 + LCD 固件。  
> 重要变更：本版本按 **LCD 液晶屏** 编写，不再采用 E-ink 的局刷、残影、定期全刷、单色/灰阶约束。

---

## 0. Scope

本 spec 只定义 SailSIQ 电子罗经 EVT 的 **设备端 LVGL UI**：

- 页面布局
- 字段格式
- 状态样式
- 四键交互
- LCD 刷新/背光策略
- `ui_model_t` 数据入口
- mock data 与验收条件
- 交给 AI 生成 LVGL 代码的 prompt

本 spec 不定义：传感器驱动、GNSS 解析、航向融合算法、日志底层、Web 复盘平台 UI。

---

## 1. Target Device Assumptions

| Item | Spec |
|---|---|
| Display | 400×300 LCD，横屏。若最终面板分辨率不同，只改 `UI_SCREEN_W/H` 与坐标常量 |
| Color | 普通反射式单色 LCD；只使用黑 / 白 / 灰，不使用语义色 |
| UI Framework | LVGL 9.x 优先；如 SDK 使用 LVGL 8.3，用兼容宏 |
| Input | 四个物理按键，无触摸 |
| Pages | Compass / Start / Mark / Finish / Settings-Calibration |
| Refresh | LVGL 连续刷新；目标 15–30 FPS，数据字段按频率更新，按键反馈即时 |
| Language | 页面短标签用英文，减少字体体积 |
| Primary environment | 户外强光、水上、快速扫视、单手盲操 |

### LVGL version constraint

优先使用 LVGL 9.x：

```c
lv_screen_load(scr);
lv_screen_active();
lv_button_create(parent);
lv_image_create(parent);
```

若目标项目是 LVGL 8.3，替换为：

```c
lv_scr_load(scr);
lv_scr_act();
lv_btn_create(parent);
lv_img_create(parent);
```

---

## 2. Information Architecture

### 2.1 Main page cycle

```text
Compass -> Start -> Mark -> Finish -> Compass
```

长按 PAGE 从任意主页面进入 Settings。Settings 内短按 PAGE 返回，长按 PAGE 退出到主页面。

### 2.2 Page list

| Page ID | Page | Purpose |
|---|---|---|
| `UI_PAGE_COMPASS` | Compass | 默认罗经页：Heading / SOG / Drift |
| `UI_PAGE_START` | Start | Fleet / Match 起航：Ready 与 Active 两态 |
| `UI_PAGE_MARK` | Mark | 航段对标：Heading / SOG / VMG / Drift / DTG / BRG / ETA |
| `UI_PAGE_FINISH` | Finish | 冲线：Heading / VMG / SOG / Drift / DTG / TTL / Angle |
| `UI_PAGE_SETTINGS` | Settings | 系统设置、赛场模板、标定入口 |
| `UI_PAGE_CALIBRATION` | Calibration | Set Pin / Set Boat / Set Mark / Orbit Mark |

### 2.3 Auto scene state

```text
START_WAIT
  -> START_ACTIVE
  -> UPWIND_MARK
  -> OFFSET_MARK optional
  -> DOWNWIND_MARK
  -> UPWIND_FINISH or DOWNWIND_FINISH
  -> START_WAIT
```

PAGE 手动切页后进入 `manual_override`，建议 30s 内不自动跳页。

---

## 3. Visual System / Design Tokens

### 3.1 Coordinate constants

```c
#define UI_SCREEN_W 400
#define UI_SCREEN_H 300
#define UI_SAFE_X   10
#define UI_TOPBAR_H 22
#define UI_CARD_X   10
#define UI_CARD_Y   36
#define UI_CARD_W   380
#define UI_CARD_H   220
#define UI_FOOT_Y   262
#define UI_FOOT_H   28
```

### 3.2 Reflective monochrome LCD tokens

目标屏是普通反射式液晶，UI 不使用彩色语义。WARN/DANGER/OK 只能通过 **明确文字、反白、粗边框、闪烁或图标/符号** 区分，不能依赖红/绿/黄/蓝。

| Token | Suggested value | Use |
|---|---:|---|
| `UI_COLOR_BG` | `0xF2F2F2` | 页面背景，模拟反射 LCD 底色 |
| `UI_COLOR_PANEL` | `0xFFFFFF` | 主信息卡，单色浅底 |
| `UI_COLOR_TEXT` | `0x111111` | 主文字 |
| `UI_COLOR_MUTED` | `0x555555` | 次要文字 / 禁用字段 |
| `UI_COLOR_LINE` | `0x111111` | 分割线 / 边框 |
| `UI_COLOR_OK` | `0x111111` | 正常、已锁定、记录正常，不能用绿色 |
| `UI_COLOR_WARN` | `0x111111` | 低速、磁置信度低、Box/Late 临界，必须配文字/边框 |
| `UI_COLOR_DANGER` | `0x111111` | OCS、REC fail、MAG BAD、低电量，必须反白或粗框 |
| `UI_COLOR_BLUE` | `0x111111` | 导航、目标、可操作状态，不能用蓝色 |
| `UI_COLOR_INV_BG` | `0x111111` | 反白背景 |
| `UI_COLOR_INV_TEXT` | `0xFFFFFF` | 反白文字 |

### 3.3 LCD brightness / theme profiles

```c
typedef enum {
    LCD_PROFILE_DAY,
    LCD_PROFILE_NIGHT,
    LCD_PROFILE_POWER_SAVE,
} ui_brightness_profile_t;
```

| Profile | Use | Notes |
|---|---|---|
| `LCD_PROFILE_DAY` | 户外强光默认 | 浅底黑字、粗边框 |
| `LCD_PROFILE_NIGHT` | 夜间/室内 | 只调整背光；P0 不做彩色/深色主题 |
| `LCD_PROFILE_POWER_SAVE` | 低电量 | 降低背光与非关键更新频率，但倒计时/警告即时刷新 |

### 3.4 Font scale

| Token | Pixel height | Use |
|---|---:|---|
| `FONT_STATUS` | 16 | 顶栏状态 |
| `FONT_LABEL` | 18–22 | 字段名 |
| `FONT_BODY` | 28–34 | 普通数值 |
| `FONT_MED` | 44–56 | 倒计时 / 中号状态 |
| `FONT_LARGE` | 76–96 | SOG / VMG 等大数字 |
| `FONT_XL` | 116–136 | Heading / Ready 时间 |

建议后期单独生成数字字体，至少包含：

```text
0123456789.-+°:mnsktREADYBURNLATELINEVMGSOGDRIFTDTGBRGETATTLBOXFIXSATRECBAT
```

### 3.5 Common layout

```text
0,0 ┌──────────────────────────────────────┐
    │ Top Bar: FIX SAT REC TIME BAT%        │ h=42
36  │ ┌──────────────────────────────────┐ │
    │ │ Main Card                        │ │ h=220
262 │ └──────────────────────────────────┘ │
    │ Foot Bar / Hints / Warnings          │ h=28
300 └──────────────────────────────────────┘
```

---

## 4. Global Components

### 4.1 Top Bar

所有主页面复用相同顶栏。

```text
FIX    SAT    REC●    TIME    BAT%
```

| Object | x | y | w | h | Align | Format |
|---|---:|---:|---:|---:|---|---|
| `lbl_fix` | 20 | 20 | 80 | 18 | left | `FIX 3D` / `NOFIX` |
| `lbl_sat` | 120 | 20 | 80 | 18 | left | `SAT 12` |
| `lbl_rec` | 240 | 20 | 80 | 18 | left | `REC●` / `RECx` |
| `lbl_time` | 360 | 20 | 100 | 18 | left | `14:32` |
| `lbl_bat` | 690 | 20 | 90 | 18 | right | `BAT 82%` |

State style:

| State | Style |
|---|---|
| `REC●` | black text or filled dot |
| `RECx` | inverted block + `RECx` text |
| `NOFIX` | explicit `NOFIX` text; GNSS-dependent fields become `--` |
| `BAT LOW` | inverted block + text `BAT LOW` |

### 4.2 Main Card

Default: `x=10 y=36 w=380 h=220`.

Style:

- background: `UI_COLOR_PANEL`
- border: 2–3px black
- radius: 8px, can be 0 on low-end LCD driver
- padding: 10–14px

### 4.3 Foot Bar

Mark / Finish / Settings 使用。Start / Compass 可隐藏或作为 warning area。

```text
x=10 y=262 w=380 h=28
```

Examples:

```text
DTG 0.42 nm   BRG 32°   ETA 2:11
KEEP MARK TO PORT
MAG LOW
LOW SPD
```

---

## 5. Value Formatting Rules

| Field | Unit | Format | Bad / Missing |
|---|---|---|---|
| Heading | degrees | `000°`–`359°` | `---°` |
| SOG | knots | `5.7` | `--` |
| Drift | degrees | `+25°` / `-1°` | `--` |
| VMG | knots | `2.1` / `-0.4` | `--` |
| DTG | nm / m | `0.42 nm`，近距离 `82 m` | `--` |
| BRG | degrees | `32°` | `--` |
| ETA | mm:ss | `2:11` | `--:--` |
| TTL | seconds | `11s` | `--` |
| LINE | meters | `-18 m` / `5 m` | `--` |
| Burn/Late | seconds | `BURN +12s` / `LATE 8s` | `--` |

### 5.1 Alert display rules

| Condition | UI |
|---|---|
| GNSS no fix | Topbar `NOFIX`，GNSS 派生字段显示 `--` |
| SOG below threshold | Foot bar `LOW SPD`，TTL/VMG 显示 `--` |
| Heading confidence < 60% | Foot bar `MAG LOW` |
| Magnetic interference | `MAG BAD`，inverted + thick border + short blink |
| Logger fail | Topbar `RECx` inverted |
| Battery low | Topbar `BAT LOW` inverted |
| OCS risk | `LINE` or `OCS` inverted, text must be explicit |

---

# 6. Page Specs

## 6.1 Compass Page

### Wireframe

```text
Compass
FIX   SAT   REC●   TIME   BAT%
------------------------------------------------
| HEADING                                      |
|                 360°                         |
|----------------------------------------------|
| SOG                    | DRIFT               |
| 5.7                    | +25°                |
------------------------------------------------
```

### Layout

| Object | x | y | w | h | Font | Align | Text |
|---|---:|---:|---:|---:|---|---|---|
| `card` | 10 | 36 | 380 | 220 | - | - | - |
| `lbl_heading_title` | 34 | 66 | 160 | 24 | LABEL | left | `HEADING` |
| `lbl_heading_value` | 0 | 70 | 380 | 72 | XL | center | `360°` |
| `line_h` | 34 | 220 | 732 | 2 | - | - | - |
| `line_v` | 190 | 166 | 2 | 82 | - | - | - |
| `lbl_sog_title` | 34 | 236 | 160 | 24 | LABEL | left | `SOG` |
| `lbl_sog_value` | 60 | 262 | 280 | 68 | LARGE | left | `5.7` |
| `lbl_drift_title` | 420 | 236 | 160 | 24 | LABEL | left | `DRIFT` |
| `lbl_drift_value` | 455 | 262 | 260 | 68 | LARGE | left | `+25°` |

Data:

```c
heading_deg
sog_kn
cog_deg
heading_confidence
fix_status
sat_count
recording
battery_percent
```

`drift_deg = wrap180(cog_deg - heading_deg)`。当 `NOFIX` 或 `sog_kn <= 1.0` 时显示 `--`。

Buttons:

| Input | Action |
|---|---|
| PAGE short | Start page |
| PAGE long | Settings |
| ACTION short | cycle secondary info, optional |
| ACTION long | toggle brightness/profile; debug build may force redraw |
| +/- | no-op |

---

## 6.2 Start Ready Page

### Wireframe

```text
Start Ready
FIX   SAT   REC●   TIME   BAT%
------------------------------------------------
|                 READY   5:00                 |
|----------------------------------------------|
| SOG                    | LINE                |
| 3.6                    | -18 m               |
------------------------------------------------
```

### Layout

| Object | x | y | w | h | Font | Align | Text |
|---|---:|---:|---:|---:|---|---|---|
| `lbl_ready` | 0 | 64 | 380 | 80 | XL | center | `READY 5:00` |
| `line_h` | 34 | 220 | 732 | 2 | - | - | - |
| `line_v` | 190 | 166 | 2 | 82 | - | - | - |
| `lbl_sog_title` | 34 | 236 | 160 | 24 | LABEL | left | `SOG` |
| `lbl_sog_value` | 60 | 262 | 280 | 68 | LARGE | left | `3.6` |
| `lbl_line_title` | 420 | 236 | 160 | 24 | LABEL | left | `LINE` |
| `lbl_line_value` | 455 | 262 | 260 | 68 | LARGE | left | `-18 m` |

Buttons:

| Input | Action |
|---|---|
| PAGE short | Mark page |
| PAGE long | Settings |
| ACTION short | start countdown, log `EVENT_START_TIMER`, trigger file segment |
| ACTION long | enter start config mode |
| ADJUST - short | preset time -1min |
| ADJUST + short | preset time +1min |
| ADJUST -/+ long | fast preset adjust |

---

## 6.3 Start Active Page — Fleet / after Match Box

### Wireframe

```text
Start Active
FIX   SAT   REC●   TIME   BAT%
------------------------------------------------
|  LATE -> [ BURN ]                  +12 s     |
|                    T- 00:23                  |
|----------------------------------------------|
| SOG                    | LINE  5 m           |
| 3.0                    | TTL   11 s          |
------------------------------------------------
```

### Layout

| Object | x | y | w | h | Font | Align | Text |
|---|---:|---:|---:|---:|---|---|---|
| `lbl_burn_label` | 60 | 68 | 180 | 44 | MED | left | `BURN` / `LATE` |
| `lbl_burn_value` | 610 | 68 | 140 | 44 | MED | right | `+12s` / `8s` |
| `lbl_timer` | 0 | 106 | 380 | 56 | LARGE | center | `T- 00:23` |
| `line_h` | 34 | 220 | 732 | 2 | - | - | - |
| `line_v` | 190 | 166 | 2 | 82 | - | - | - |
| `lbl_sog_title` | 34 | 236 | 160 | 24 | LABEL | left | `SOG` |
| `lbl_sog_value` | 60 | 262 | 280 | 68 | LARGE | left | `3.0` |
| `lbl_line_ttl` | 420 | 242 | 300 | 70 | BODY | left | `LINE 5 m\nTTL 11s` |

Burn style:

| State | Style |
|---|---|
| `BURN +Ns` | large outlined or inverted badge when urgent |
| `LATE Ns` | inverted badge if late >0 |
| `OCS` or line positive before start | inverted, explicit `OCS` text |

Buttons:

| Input | Action |
|---|---|
| PAGE short | Mark page |
| PAGE long | Settings |
| ACTION short | SYNC to nearest lower minute |
| ACTION long | stop and reset to Ready |
| ADJUST - short | countdown -1s |
| ADJUST + short | countdown +1s |
| ADJUST -/+ long | repeat adjustment, 10s step optional |

---

## 6.4 Match Start Page — pre Box

Match Start has two sub-states.

### Pre-box wireframe

```text
Match Pre-Box
FIX   SAT   REC●   TIME   BAT%
------------------------------------------------
|                 T- 04:23                     |
|                 BOX in 0:23                  |
|----------------------------------------------|
| BOX BURN +8s           | SOG  2.4            |
| BOX: OUT               | LINE -68 m          |
------------------------------------------------
```

Fields:

| Field | Format |
|---|---|
| Main countdown | `T- mm:ss` to start signal |
| Box countdown | `BOX in mm:ss` |
| Box burn/late | `BOX BURN +8s` / `BOX LATE 3s` |
| Box state | `BOX: IN` / `BOX: OUT` |
| SOG | knots |
| LINE | signed distance |

After box entry time, Match page reuses Start Active layout and adds `BOX: IN/OUT` badge in lower right or foot bar.

---

## 6.5 Mark Page

### Wireframe

```text
Mark
FIX   SAT   REC●   TIME   BAT%
------------------------------------------------
| HEADING                                      |
|                 114°                         |
|----------------------------------------------|
| SOG                    | VMG  2.1            |
| 5.0                    | DRIFT -1°           |
------------------------------------------------
DTG 0.42 nm   BRG 32°   ETA 2:11
```

### Layout

| Object | x | y | w | h | Font | Align | Text |
|---|---:|---:|---:|---:|---|---|---|
| `lbl_heading_title` | 34 | 66 | 160 | 24 | LABEL | left | `HEADING` |
| `lbl_heading_value` | 0 | 70 | 380 | 72 | XL | center | `114°` |
| `line_h` | 34 | 220 | 732 | 2 | - | - | - |
| `line_v` | 190 | 166 | 2 | 82 | - | - | - |
| `lbl_sog_title` | 34 | 236 | 160 | 24 | LABEL | left | `SOG` |
| `lbl_sog_value` | 60 | 262 | 280 | 68 | LARGE | left | `5.0` |
| `lbl_vmg_drift` | 420 | 242 | 300 | 70 | BODY | left | `VMG 2.1\nDRIFT -1°` |
| `lbl_footer` | 10 | 262 | 380 | 28 | BODY | center | `DTG 0.42 nm   BRG 32°   ETA 2:11` |

Foot bar alternate message:

```text
KEEP MARK TO PORT
KEEP MARK TO STBD
APPROACH LOCK
MARK ROUND OK
```

Buttons:

| Input | Action |
|---|---|
| PAGE short | Finish page |
| PAGE long | Settings |
| ACTION short | Confirm Rounding; switch next leg |
| ACTION long | toggle Auto / Manual scene mode |
| ADJUST -/+ short | cycle secondary field DTG / VMG / ETA / Time |

---

## 6.6 Finish Page

### Wireframe

```text
Finish
FIX   SAT   REC●   TIME   BAT%
------------------------------------------------
|                 114°                         |
|----------------------------------------------|
| VMG  2.11              | SOG   5.3           |
|                        | DRIFT -1°           |
------------------------------------------------
DTG 0.42 nm   TTL 0:18   ANG +8°
```

### Layout

| Object | x | y | w | h | Font | Align | Text |
|---|---:|---:|---:|---:|---|---|---|
| `lbl_heading_value` | 0 | 66 | 380 | 76 | XL | center | `114°` |
| `line_h` | 34 | 220 | 732 | 2 | - | - | - |
| `line_v` | 190 | 166 | 2 | 82 | - | - | - |
| `lbl_vmg` | 34 | 242 | 320 | 70 | BODY/LARGE | left | `VMG 2.11` |
| `lbl_sog_drift` | 420 | 242 | 300 | 70 | BODY | left | `SOG 5.3\nDRIFT -1°` |
| `lbl_footer` | 10 | 262 | 380 | 28 | BODY | center | `DTG 0.42 nm   TTL 0:18   ANG +8°` |

Finish-specific states:

| State | Display |
|---|---|
| Before finish | `TTL 0:18`, `LINE -24m` optional |
| Crossed finish | `FINISH` large or foot bar, log `EVENT_FINISH_CROSS` |
| Angle too large | `ANG +18°` in warn style |

Buttons:

| Input | Action |
|---|---|
| PAGE short | Compass page |
| PAGE long | Settings |
| ACTION short | Log Finish marker |
| ACTION long | Manual file segment |

---

## 6.7 Settings / Calibration Page

### Layout

```text
Settings
FIX   SAT   REC●   TIME   BAT%
------------------------------------------------
| > Race Mode: Fleet       | Course diagram     |
|   Start Config           |                    |
|   Course Template        |     WM             |
|   Calibration            |      |             |
|   Units                  |  Start ---- Finish |
|   System                 |      |             |
------------------------------------------------
PG Back   AC Enter   +/- Move
```

| Object | x | y | w | h | Role |
|---|---:|---:|---:|---:|---|
| `panel_left` | 10 | 36 | 165 | 220 | menu list |
| `panel_right` | 185 | 36 | 205 | 220 | diagram preview |
| `line_split` | 175 | 36 | 2 | 220 | vertical split |
| `lbl_title` | 34 | 64 | 280 | 28 | `Set Mark` / `Heading` |
| `menu_item_0..6` | 34 | `96+32n` | 290 | 28 | selected item with `>` |
| `diagram_canvas` | 390 | 70 | 360 | 230 | LVGL lines/circles/labels |
| `footer_help` | 10 | 262 | 380 | 28 | button hints |

### Menu tree

```text
Settings
├── Race Mode: Fleet / Match
├── Start Config
│   ├── Fleet Start Time
│   ├── Match Start Time
│   └── Match Box Time
├── Course Template
│   ├── Course Type: W-L
│   ├── Finish After: Upwind / Downwind
│   ├── Num Laps: 1..N
│   ├── Has Offset: On / Off
│   └── Leeward Mode: Single / Gate
├── Calibration
│   ├── Set Pin
│   ├── Set Boat
│   ├── Set Finish Pin
│   ├── Set Finish Boat
│   ├── Set Windward Mark
│   ├── Set Offset Mark
│   ├── Set Leeward Mark / Gate
│   └── Orbit Mark
├── Display
│   ├── Brightness Profile: Day / Night / Power Save
│   ├── Brightness: 0..100%
│   └── Theme: High Contrast / Night
├── Units: kn / nm / deg
└── System: Logger / GNSS / Mag / Battery / About
```

Buttons:

| Input | Action |
|---|---|
| PAGE short | Back one level |
| PAGE long | Exit to previous main page |
| ACTION short | Enter / Edit / Trigger selected action |
| ACTION long | Save and exit current edit |
| ADJUST - short | Previous item / decrease value |
| ADJUST + short | Next item / increase value |
| ADJUST -/+ long | Fast scroll / fast adjust |

---

# 7. Button Input Model

```c
typedef enum {
    UI_BTN_PAGE,
    UI_BTN_ACTION,
    UI_BTN_ADJUST_MINUS,
    UI_BTN_ADJUST_PLUS,
} ui_button_t;

typedef enum {
    UI_PRESS_SHORT,
    UI_PRESS_LONG,
    UI_PRESS_REPEAT,
} ui_press_t;
```

- Short press: release before 1000ms.
- Long press: pressed for >= 1000ms.
- Repeat: after long press, emit every 150–250ms.
- 不使用组合键。

---

# 8. UI Data Model

```c
typedef enum {
    UI_PAGE_COMPASS,
    UI_PAGE_START,
    UI_PAGE_MARK,
    UI_PAGE_FINISH,
    UI_PAGE_SETTINGS,
    UI_PAGE_CALIBRATION,
} ui_page_t;

typedef enum { RACE_FLEET, RACE_MATCH } race_mode_t;

typedef enum {
    SCENE_START_WAIT,
    SCENE_START_ACTIVE,
    SCENE_UPWIND_MARK,
    SCENE_OFFSET_MARK,
    SCENE_DOWNWIND_MARK,
    SCENE_UPWIND_FINISH,
    SCENE_DOWNWIND_FINISH,
} active_scene_t;

typedef enum { FIX_NONE, FIX_2D, FIX_3D } gnss_fix_t;
typedef enum { ROUND_UNKNOWN, ROUND_PORT, ROUND_STARBOARD } rounding_side_t;

typedef struct {
    gnss_fix_t fix;
    uint8_t sat_count;
    bool recording;
    uint8_t battery_percent;
    uint8_t hour;
    uint8_t minute;
    bool logger_error;
} ui_status_t;

typedef struct {
    float heading_deg;
    float cog_deg;
    float sog_kn;
    float drift_deg;
    float vmg_mark_kn;
    float vmg_finish_kn;
    float dtg_m;
    float brg_deg;
    int32_t eta_sec;
    int32_t ttl_sec;
    float line_dist_m;
    float finish_line_dist_m;
    float angle_error_deg;
    uint8_t heading_confidence;
    uint16_t turns_count;
    bool mag_bad;
} ui_nav_t;

typedef struct {
    race_mode_t race_mode;
    active_scene_t active_scene;
    int32_t countdown_sec;
    int32_t preset_start_sec;
    int32_t match_box_sec;
    int32_t box_in_sec;
    int32_t burn_sec;
    int32_t box_burn_sec;
    bool box_in;
    bool ocs_risk;
    bool timer_running;
} ui_start_t;

typedef struct {
    char target_id[8];
    rounding_side_t rounding_side;
    bool target_configured;
    bool approach_lock;
    bool auto_scene_enabled;
    bool manual_override;
} ui_course_t;

typedef struct {
    ui_brightness_profile_t brightness_profile;
    uint8_t lcd_brightness_percent;
    bool night_mode;
} ui_display_t;

typedef struct {
    ui_status_t status;
    ui_nav_t nav;
    ui_start_t start;
    ui_course_t course;
    ui_display_t display;
} ui_model_t;
```

UI API:

```c
void ui_init(void);
void ui_set_page(ui_page_t page);
void ui_update(const ui_model_t *m);
void ui_handle_button(ui_button_t btn, ui_press_t press);
void ui_request_redraw(void);
void ui_set_brightness_profile(ui_brightness_profile_t profile);
```

---

# 9. LVGL Project Structure

Recommended files:

```text
main/ui/
├── ui.h / ui.c
├── ui_model.h
├── ui_styles.h / ui_styles.c
├── ui_format.h / ui_format.c
├── ui_topbar.h / ui_topbar.c
├── ui_compass.h / ui_compass.c
├── ui_start.h / ui_start.c
├── ui_mark.h / ui_mark.c
├── ui_finish.h / ui_finish.c
└── ui_settings.h / ui_settings.c
```

Implementation rules:

1. `ui_init()` creates page objects once.
2. `ui_update()` only changes label text, style state, hidden/visible, and invalidates changed objects.
3. Do not delete/recreate object tree every second.
4. Styles live in `ui_styles.c`.
5. Format functions live in `ui_format.c`.
6. UI must not read sensors directly; only consume `ui_model_t`.
7. Use fixed char buffers for dynamic strings; avoid heap allocation inside UI update.
8. LCD driver, backlight PWM, and touch/flush callbacks stay outside `main/ui/`.
9. Page layout editing is preset-based only. Do not implement drag, resize, or free-coordinate editing. See `sailsiq_layout_presets.md`.

---

# 10. LCD Refresh / Update Strategy

LCD 不需要 E-ink 的局刷、抗残影或定期全刷。页面代码仍应 “create once, update only”，让 LVGL 自己处理 invalidation。

| Data / Event | UI update frequency / behavior |
|---|---:|
| Heading | P0 先 2–5Hz；如数字抖动，显示层做 0.3–0.5s smoothing |
| SOG / COG / VMG / Drift | 2–5Hz；显示值可 0.3–1.0s smoothing |
| Countdown | 1Hz exact；秒跳变必须准 |
| Topbar GNSS / REC | 1Hz |
| Battery | 0.1Hz 或电量变化时 |
| Button feedback | immediate，<50ms 内视觉反馈 |
| Settings menu | input event only |
| Warning enter/exit | immediate；可用 1–2 次短闪烁，不持续闪屏 |

Recommended LVGL behavior:

| Object group | Update rule |
|---|---|
| Topbar labels | 文本变化时更新 |
| Large value labels | 数值变化超过显示精度时更新 |
| Warning badges | 状态变化时更新 text + style |
| Page containers | 页面切换时 show/hide，不 delete/recreate |
| Theme / brightness | 通过统一 style/theme 函数重设 |

Full-screen restyle / redraw triggers:

- Page switch
- Enter / exit Settings
- Brightness/profile change
- Day/night theme change
- Logger failure first detected
- Magnetometer bad first detected
- Developer/debug redraw request

---

# 11. Simulator / Mock Data

Keyboard mapping:

| Key | Button |
|---|---|
| `Tab` | PAGE short |
| `Enter` | ACTION short |
| `-` | ADJUST - short |
| `=` / `+` | ADJUST + short |
| `Shift+Tab` | PAGE long |
| `Shift+Enter` | ACTION long |

Mock scenarios:

1. Compass steady heading: heading 350° -> 010° wraparound.
2. Start Ready: preset 5:00, SOG 3.6, LINE -18m.
3. Start Active Burn: countdown 23s, SOG 3.0, LINE 5m, TTL 11s, BURN +12s.
4. Start Active Late: countdown 10s, LINE -40m, TTL 25s, LATE 15s.
5. Match Pre-Box: countdown 4:23, BOX in 0:23, BOX BURN +8s.
6. Mark approach: DTG 0.42nm -> 80m, VMG positive.
7. Mark warning: `KEEP MARK TO PORT`.
8. Finish approach: TTL valid, ANG +8°.
9. NOFIX: top bar `NOFIX`, GNSS fields `--`.
10. MAG LOW: heading confidence 45%, foot `MAG LOW`.
11. Logger fail: `RECx` inverted.
12. LCD profile switch: DAY -> NIGHT -> POWER_SAVE.

---

# 12. Vibe Coding Prompt

```text
你是嵌入式 GUI 工程师。请根据 `sailsiq_lvgl_ui_spec_v1_1_lcd.md` 生成 LVGL 9.x C 代码。

硬性要求：
1. 目标分辨率固定 400x300，横屏 LCD；不要写 E-ink 局刷、残影或定期全刷逻辑。
2. 不要改 main.c 的 LVGL/SDL 初始化，只生成 main/ui/ 目录代码。
3. 页面包括 Compass、Start、Mark、Finish、Settings/Calibration。
4. 所有页面 create once；update 时只改 label text/style/hidden，不要每秒重建对象。
5. 样式集中在 ui_styles.c。
6. 使用英文短标签；UI 只使用黑/白/灰，WARN/DANGER 必须用文字、反白、粗边框区分。
7. 用 ui_model_t 作为唯一 UI 数据输入。
8. 提供 mock data，让 PC simulator 不接传感器也能看到动态页面。
9. 按键输入用统一 ui_handle_button(btn, press)。
10. 编译目标为 LVGL 9.x；如有 LVGL 8 兼容差异，用宏包装。
11. LCD 背光/亮度驱动不要写死在页面里，只保留 ui_set_brightness_profile() 接口。

先只生成：ui_model.h、ui.h、ui.c、ui_styles.h、ui_styles.c、ui_format.h、ui_format.c、ui_topbar.c/h、ui_compass.c/h、ui_start.c/h。
不要一次性生成 Mark/Finish/Settings，等第一批编译通过再继续。
```

Second-round prompt:

```text
现在在已编译通过的基础上，继续生成 ui_mark.c/h、ui_finish.c/h、ui_settings.c/h。
保持和现有 style/object/update 模式一致，不要重构已工作的文件。
```

---

# 13. Acceptance Criteria

## P0 UI

- [ ] 400×300 模拟器启动并显示 Compass。
- [ ] PAGE 短按循环 Compass -> Start -> Mark -> Finish。
- [ ] PAGE 长按进入 Settings。
- [ ] Start Ready 可用 +/- 调整预设时间。
- [ ] ACTION 短按从 Ready 进入 Active。
- [ ] Start Active 每秒刷新倒计时。
- [ ] Burn / Late / TTL / Line 用 mock data 正确变化。
- [ ] Mark 显示 Heading / SOG / VMG / Drift / DTG / BRG / ETA。
- [ ] Finish 显示 Heading / VMG / SOG / Drift / DTG / TTL / Angle。
- [ ] NOFIX、MAG LOW、REC fail 有明确显示。
- [ ] LCD 日间高对比模式可读；WARN/DANGER 同时具备文字、反白或粗边框提示。
- [ ] ACTION 长按可切换亮度/profile，或在 debug build 中触发 redraw。
- [ ] 不依赖触摸。

## Engineering

- [ ] UI 代码不包含传感器驱动逻辑。
- [ ] UI 数据只通过 `ui_model_t` 注入。
- [ ] 页面对象 create once，update only。
- [ ] 样式集中管理。
- [ ] 格式化函数集中管理。
- [ ] mock data 和真实数据源可切换。
- [ ] LCD driver/backlight code 不写在页面文件中。
- [ ] LVGL 9 编译通过。

---

# 14. Open Questions

| ID | Question | Recommended default |
|---|---|---|
| Q1 | 真机 LCD 接口与色深是 RGB/SPI/QSPI？ | UI 先按 LVGL `lv_color_t` 抽象，不在页面代码绑定驱动 |
| Q2 | 真机分辨率是否仍为 400×300？ | 先保留 400×300；若变更，重算坐标常量 |
| Q3 | 大数字字体是否已有？ | 先用 Montserrat，后续换自定义 digit font |
| Q4 | Start Active 是否继续显示 Heading？ | 当前 GUI 不显示，P0 不显示；后续可用 AC 切换字段 |
| Q5 | Finish 底部用 ETA 还是 TTL？ | 优先 TTL；无可靠 TTL 时退回 ETA |
| Q6 | `TURNS` 是否 P0？ | 非 P0，保留字段但默认隐藏 |
| Q7 | Settings 右侧赛场图是否必须动态？ | P0 可静态/简化 |
| Q8 | Match Start 是否第一版做完？ | 数据结构保留；UI 第一版先 Fleet，第二版补 Match |
| Q9 | 夜间主题是否 P0？ | P0 只做 brightness profile，完整夜间主题可 P1 |

---

# 15. Minimal Build Plan

## Build 1: Static UI

- Topbar
- Compass
- Start Ready
- Start Active
- Mock data
- Keyboard buttons
- LCD high-contrast style

## Build 2: Race pages

- Mark
- Finish
- Page switching
- Update-only label refresh

## Build 3: Settings / Calibration

- Settings root menu
- Calibration menu
- Sampling state
- Course template editor
- Display brightness/profile menu

## Build 4: Firmware integration

- Replace mock with real `app_state`
- Button driver integration
- Logger / scene event integration
- LCD driver / backlight / brightness profile integration

---

# 16. Notes for AI Code Generation

Good request:

```text
按照 spec 生成 LVGL 9 UI，只生成 main/ui/ 文件，不要写驱动，不要重构 main.c。
```

Bad request:

```text
帮我做完整 SailSIQ 固件。
```

Recommended iteration:

1. Generate Compass + Topbar only.
2. Compile simulator.
3. Add Start Ready + Active.
4. Add buttons.
5. Add Mark / Finish.
6. Add Settings.
7. Connect real `ui_model_t`.
