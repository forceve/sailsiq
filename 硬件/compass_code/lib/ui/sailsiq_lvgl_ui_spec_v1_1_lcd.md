# SailSIQ EVT LVGL UI Spec v1.1 鈥?LCD Edition

> 鐩殑锛氭妸浜у搧寮€鍙戞墜鍐屻€丟UI 绀烘剰鍥俱€侀〉闈?ASCII 澶嶅埢鍜屽鐩樺钩鍙拌姹傦紝鏁寸悊鎴愪竴浠藉彲浠ョ洿鎺ヤ氦缁?Cursor / Claude Code / ChatGPT 鐢熸垚 LVGL 椤甸潰浠ｇ爜鐨勫伐绋?spec銆?
> 鐩爣锛氬厛鍦?400脳300 PC simulator 璺戦€氶〉闈紝鍐嶇Щ妞嶅埌 ESP32-S3 + LCD 鍥轰欢銆?
> 閲嶈鍙樻洿锛氭湰鐗堟湰鎸?**LCD 娑叉櫠灞?* 缂栧啓锛屼笉鍐嶉噰鐢?E-ink 鐨勫眬鍒枫€佹畫褰便€佸畾鏈熷叏鍒枫€佸崟鑹?鐏伴樁绾︽潫銆?
---

## 0. Scope

鏈?spec 鍙畾涔?SailSIQ 鐢靛瓙缃楃粡 EVT 鐨?**璁惧绔?LVGL UI**锛?
- 椤甸潰甯冨眬
- 瀛楁鏍煎紡
- 鐘舵€佹牱寮?- 鍥涢敭浜や簰
- LCD 鍒锋柊/鑳屽厜绛栫暐
- `ui_model_t` 鏁版嵁鍏ュ彛
- mock data 涓庨獙鏀舵潯浠?- 浜ょ粰 AI 鐢熸垚 LVGL 浠ｇ爜鐨?prompt

鏈?spec 涓嶅畾涔夛細浼犳劅鍣ㄩ┍鍔ㄣ€丟NSS 瑙ｆ瀽銆佽埅鍚戣瀺鍚堢畻娉曘€佹棩蹇楀簳灞傘€乄eb 澶嶇洏骞冲彴 UI銆?
---

## 1. Target Device Assumptions

| Item | Spec |
|---|---|
| Display | 400脳300 LCD锛屾í灞忋€傝嫢鏈€缁堥潰鏉垮垎杈ㄧ巼涓嶅悓锛屽彧鏀?`UI_SCREEN_W/H` 涓庡潗鏍囧父閲?|
| Color | 鏅€氬弽灏勫紡鍗曡壊 LCD锛涘彧浣跨敤榛?/ 鐧?/ 鐏帮紝涓嶄娇鐢ㄨ涔夎壊 |
| UI Framework | LVGL 9.x 浼樺厛锛涘 SDK 浣跨敤 LVGL 8.3锛岀敤鍏煎瀹?|
| Input | 鍥涗釜鐗╃悊鎸夐敭锛屾棤瑙︽懜 |
| Pages | Compass / Start / Mark / Finish / Settings-Calibration |
| Refresh | LVGL 杩炵画鍒锋柊锛涚洰鏍?15鈥?0 FPS锛屾暟鎹瓧娈垫寜棰戠巼鏇存柊锛屾寜閿弽棣堝嵆鏃?|
| Language | 椤甸潰鐭爣绛剧敤鑻辨枃锛屽噺灏戝瓧浣撲綋绉?|
| Primary environment | 鎴峰寮哄厜銆佹按涓娿€佸揩閫熸壂瑙嗐€佸崟鎵嬬洸鎿?|

### LVGL version constraint

浼樺厛浣跨敤 LVGL 9.x锛?
```c
lv_screen_load(scr);
lv_screen_active();
lv_button_create(parent);
lv_image_create(parent);
```

鑻ョ洰鏍囬」鐩槸 LVGL 8.3锛屾浛鎹负锛?
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

闀挎寜 PAGE 浠庝换鎰忎富椤甸潰杩涘叆 Settings銆係ettings 鍐呯煭鎸?PAGE 杩斿洖锛岄暱鎸?PAGE 閫€鍑哄埌涓婚〉闈€?
### 2.2 Page list

| Page ID | Page | Purpose |
|---|---|---|
| `UI_PAGE_COMPASS` | Compass | 榛樿缃楃粡椤碉細Heading / SOG / Drift |
| `UI_PAGE_START` | Start | Fleet / Match 璧疯埅锛歊eady 涓?Active 涓ゆ€?|
| `UI_PAGE_MARK` | Mark | 鑸瀵规爣锛欻eading / SOG / VMG / Drift / DTG / BRG / ETA |
| `UI_PAGE_FINISH` | Finish | 鍐茬嚎锛欻eading / VMG / SOG / Drift / DTG / TTL / Angle |
| `UI_PAGE_SETTINGS` | Settings | 绯荤粺璁剧疆銆佽禌鍦烘ā鏉裤€佹爣瀹氬叆鍙?|
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

PAGE 鎵嬪姩鍒囬〉鍚庤繘鍏?`manual_override`锛屽缓璁?30s 鍐呬笉鑷姩璺抽〉銆?
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

鐩爣灞忔槸鏅€氬弽灏勫紡娑叉櫠锛孶I 涓嶄娇鐢ㄥ僵鑹茶涔夈€俉ARN/DANGER/OK 鍙兘閫氳繃 **鏄庣‘鏂囧瓧銆佸弽鐧姐€佺矖杈规銆侀棯鐑佹垨鍥炬爣/绗﹀彿** 鍖哄垎锛屼笉鑳戒緷璧栫孩/缁?榛?钃濄€?
| Token | Suggested value | Use |
|---|---:|---|
| `UI_COLOR_BG` | `0xF2F2F2` | 椤甸潰鑳屾櫙锛屾ā鎷熷弽灏?LCD 搴曡壊 |
| `UI_COLOR_PANEL` | `0xFFFFFF` | 涓讳俊鎭崱锛屽崟鑹叉祬搴?|
| `UI_COLOR_TEXT` | `0x111111` | 涓绘枃瀛?|
| `UI_COLOR_MUTED` | `0x555555` | 娆¤鏂囧瓧 / 绂佺敤瀛楁 |
| `UI_COLOR_LINE` | `0x111111` | 鍒嗗壊绾?/ 杈规 |
| `UI_COLOR_OK` | `0x111111` | 姝ｅ父銆佸凡閿佸畾銆佽褰曟甯革紝涓嶈兘鐢ㄧ豢鑹?|
| `UI_COLOR_WARN` | `0x111111` | 浣庨€熴€佺缃俊搴︿綆銆丅ox/Late 涓寸晫锛屽繀椤婚厤鏂囧瓧/杈规 |
| `UI_COLOR_DANGER` | `0x111111` | OCS銆丷EC fail銆丮AG BAD銆佷綆鐢甸噺锛屽繀椤诲弽鐧芥垨绮楁 |
| `UI_COLOR_BLUE` | `0x111111` | 瀵艰埅銆佺洰鏍囥€佸彲鎿嶄綔鐘舵€侊紝涓嶈兘鐢ㄨ摑鑹?|
| `UI_COLOR_INV_BG` | `0x111111` | 鍙嶇櫧鑳屾櫙 |
| `UI_COLOR_INV_TEXT` | `0xFFFFFF` | 鍙嶇櫧鏂囧瓧 |

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
| `LCD_PROFILE_DAY` | 鎴峰寮哄厜榛樿 | 娴呭簳榛戝瓧銆佺矖杈规 |
| `LCD_PROFILE_NIGHT` | 澶滈棿/瀹ゅ唴 | 鍙皟鏁磋儗鍏夛紱P0 涓嶅仛褰╄壊/娣辫壊涓婚 |
| `LCD_PROFILE_POWER_SAVE` | 浣庣數閲?| 闄嶄綆鑳屽厜涓庨潪鍏抽敭鏇存柊棰戠巼锛屼絾鍊掕鏃?璀﹀憡鍗虫椂鍒锋柊 |

### 3.4 Font scale

| Token | Pixel height | Use |
|---|---:|---|
| `FONT_STATUS` | 16 | 椤舵爮鐘舵€?|
| `FONT_LABEL` | 18鈥?2 | 瀛楁鍚?|
| `FONT_BODY` | 28鈥?4 | 鏅€氭暟鍊?|
| `FONT_MED` | 44鈥?6 | 鍊掕鏃?/ 涓彿鐘舵€?|
| `FONT_LARGE` | 76鈥?6 | SOG / VMG 绛夊ぇ鏁板瓧 |
| `FONT_XL` | 116鈥?36 | Heading / Ready 鏃堕棿 |

寤鸿鍚庢湡鍗曠嫭鐢熸垚鏁板瓧瀛椾綋锛岃嚦灏戝寘鍚細

```text
0123456789.-+掳:mnsktREADYBURNLATELINEVMGSOGDRIFTDTGBRGETATTLBOXFIXSATRECBAT
```

### 3.5 Common layout

```text
0,0 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?    鈹?Top Bar: FIX SAT REC TIME BAT%        鈹?h=42
36  鈹?鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?鈹?    鈹?鈹?Main Card                        鈹?鈹?h=220
262 鈹?鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?鈹?    鈹?Foot Bar / Hints / Warnings          鈹?h=28
300 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?```

---

## 4. Global Components

### 4.1 Top Bar

鎵€鏈変富椤甸潰澶嶇敤鐩稿悓椤舵爮銆?
```text
FIX    SAT    REC鈼?   TIME    BAT%
```

| Object | x | y | w | h | Align | Format |
|---|---:|---:|---:|---:|---|---|
| `lbl_fix` | 20 | 20 | 80 | 18 | left | `FIX 3D` / `NOFIX` |
| `lbl_sat` | 120 | 20 | 80 | 18 | left | `SAT 12` |
| `lbl_rec` | 240 | 20 | 80 | 18 | left | `REC鈼廯 / `RECx` |
| `lbl_time` | 360 | 20 | 100 | 18 | left | `14:32` |
| `lbl_bat` | 690 | 20 | 90 | 18 | right | `BAT 82%` |

State style:

| State | Style |
|---|---|
| `REC鈼廯 | black text or filled dot |
| `RECx` | inverted block + `RECx` text |
| `NOFIX` | explicit `NOFIX` text; GNSS-dependent fields become `--` |
| `BAT LOW` | inverted block + text `BAT LOW` |

### 4.2 Main Card

Default: `x=10 y=36 w=380 h=220`.

Style:

- background: `UI_COLOR_PANEL`
- border: 2鈥?px black
- radius: 8px, can be 0 on low-end LCD driver
- padding: 10鈥?4px

### 4.3 Foot Bar

Mark / Finish / Settings 浣跨敤銆係tart / Compass 鍙殣钘忔垨浣滀负 warning area銆?
```text
x=10 y=262 w=380 h=28
```

Examples:

```text
DTG 0.42 nm   BRG 32掳   ETA 2:11
KEEP MARK TO PORT
MAG LOW
LOW SPD
```

---

## 5. Value Formatting Rules

| Field | Unit | Format | Bad / Missing |
|---|---|---|---|
| Heading | degrees | `000掳`鈥揱359掳` | `---掳` |
| SOG | knots | `5.7` | `--` |
| Drift | degrees | `+25掳` / `-1掳` | `--` |
| VMG | knots | `2.1` / `-0.4` | `--` |
| DTG | nm / m | `0.42 nm`锛岃繎璺濈 `82 m` | `--` |
| BRG | degrees | `32掳` | `--` |
| ETA | mm:ss | `2:11` | `--:--` |
| TTL | seconds | `11s` | `--` |
| LINE | meters | `-18 m` / `5 m` | `--` |
| Burn/Late | seconds | `BURN +12s` / `LATE 8s` | `--` |

### 5.1 Alert display rules

| Condition | UI |
|---|---|
| GNSS no fix | Topbar `NOFIX`锛孏NSS 娲剧敓瀛楁鏄剧ず `--` |
| SOG below threshold | Foot bar `LOW SPD`锛孴TL/VMG 鏄剧ず `--` |
| Heading confidence < 60% | Foot bar `MAG LOW` |
| Magnetic interference | `MAG BAD`锛宨nverted + thick border + short blink |
| Logger fail | Topbar `RECx` inverted |
| Battery low | Topbar `BAT LOW` inverted |
| OCS risk | `LINE` or `OCS` inverted, text must be explicit |

---

# 6. Page Specs

## 6.1 Compass Page

### Wireframe

```text
Compass
FIX   SAT   REC鈼?  TIME   BAT%
------------------------------------------------
| HEADING                                      |
|                 360掳                         |
|----------------------------------------------|
| SOG                    | DRIFT               |
| 5.7                    | +25掳                |
------------------------------------------------
```

### Layout

| Object | x | y | w | h | Font | Align | Text |
|---|---:|---:|---:|---:|---|---|---|
| `card` | 10 | 36 | 380 | 220 | - | - | - |
| `lbl_heading_title` | 34 | 66 | 160 | 24 | LABEL | left | `HEADING` |
| `lbl_heading_value` | 0 | 70 | 380 | 72 | XL | center | `360掳` |
| `line_h` | 34 | 220 | 732 | 2 | - | - | - |
| `line_v` | 190 | 166 | 2 | 82 | - | - | - |
| `lbl_sog_title` | 34 | 236 | 160 | 24 | LABEL | left | `SOG` |
| `lbl_sog_value` | 60 | 262 | 280 | 68 | LARGE | left | `5.7` |
| `lbl_drift_title` | 420 | 236 | 160 | 24 | LABEL | left | `DRIFT` |
| `lbl_drift_value` | 455 | 262 | 260 | 68 | LARGE | left | `+25掳` |

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

`drift_deg = wrap180(cog_deg - heading_deg)`銆傚綋 `NOFIX` 鎴?`sog_kn <= 1.0` 鏃舵樉绀?`--`銆?
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
FIX   SAT   REC鈼?  TIME   BAT%
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

## 6.3 Start Active Page 鈥?Fleet / after Match Box

### Wireframe

```text
Start Active
FIX   SAT   REC鈼?  TIME   BAT%
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

## 6.4 Match Start Page 鈥?pre Box

Match Start has two sub-states.

### Pre-box wireframe

```text
Match Pre-Box
FIX   SAT   REC鈼?  TIME   BAT%
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
FIX   SAT   REC鈼?  TIME   BAT%
------------------------------------------------
| HEADING                                      |
|                 114掳                         |
|----------------------------------------------|
| SOG                    | VMG  2.1            |
| 5.0                    | DRIFT -1掳           |
------------------------------------------------
DTG 0.42 nm   BRG 32掳   ETA 2:11
```

### Layout

| Object | x | y | w | h | Font | Align | Text |
|---|---:|---:|---:|---:|---|---|---|
| `lbl_heading_title` | 34 | 66 | 160 | 24 | LABEL | left | `HEADING` |
| `lbl_heading_value` | 0 | 70 | 380 | 72 | XL | center | `114掳` |
| `line_h` | 34 | 220 | 732 | 2 | - | - | - |
| `line_v` | 190 | 166 | 2 | 82 | - | - | - |
| `lbl_sog_title` | 34 | 236 | 160 | 24 | LABEL | left | `SOG` |
| `lbl_sog_value` | 60 | 262 | 280 | 68 | LARGE | left | `5.0` |
| `lbl_vmg_drift` | 420 | 242 | 300 | 70 | BODY | left | `VMG 2.1\nDRIFT -1掳` |
| `lbl_footer` | 10 | 262 | 380 | 28 | BODY | center | `DTG 0.42 nm   BRG 32掳   ETA 2:11` |

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
FIX   SAT   REC鈼?  TIME   BAT%
------------------------------------------------
|                 114掳                         |
|----------------------------------------------|
| VMG  2.11              | SOG   5.3           |
|                        | DRIFT -1掳           |
------------------------------------------------
DTG 0.42 nm   TTL 0:18   ANG +8掳
```

### Layout

| Object | x | y | w | h | Font | Align | Text |
|---|---:|---:|---:|---:|---|---|---|
| `lbl_heading_value` | 0 | 66 | 380 | 76 | XL | center | `114掳` |
| `line_h` | 34 | 220 | 732 | 2 | - | - | - |
| `line_v` | 190 | 166 | 2 | 82 | - | - | - |
| `lbl_vmg` | 34 | 242 | 320 | 70 | BODY/LARGE | left | `VMG 2.11` |
| `lbl_sog_drift` | 420 | 242 | 300 | 70 | BODY | left | `SOG 5.3\nDRIFT -1掳` |
| `lbl_footer` | 10 | 262 | 380 | 28 | BODY | center | `DTG 0.42 nm   TTL 0:18   ANG +8掳` |

Finish-specific states:

| State | Display |
|---|---|
| Before finish | `TTL 0:18`, `LINE -24m` optional |
| Crossed finish | `FINISH` large or foot bar, log `EVENT_FINISH_CROSS` |
| Angle too large | `ANG +18掳` in warn style |

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
FIX   SAT   REC鈼?  TIME   BAT%
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
鈹溾攢鈹€ Race Mode: Fleet / Match
鈹溾攢鈹€ Start Config
鈹?  鈹溾攢鈹€ Fleet Start Time
鈹?  鈹溾攢鈹€ Match Start Time
鈹?  鈹斺攢鈹€ Match Box Time
鈹溾攢鈹€ Course Template
鈹?  鈹溾攢鈹€ Course Type: W-L
鈹?  鈹溾攢鈹€ Finish After: Upwind / Downwind
鈹?  鈹溾攢鈹€ Num Laps: 1..N
鈹?  鈹溾攢鈹€ Has Offset: On / Off
鈹?  鈹斺攢鈹€ Leeward Mode: Single / Gate
鈹溾攢鈹€ Calibration
鈹?  鈹溾攢鈹€ Set Pin
鈹?  鈹溾攢鈹€ Set Boat
鈹?  鈹溾攢鈹€ Set Finish Pin
鈹?  鈹溾攢鈹€ Set Finish Boat
鈹?  鈹溾攢鈹€ Set Windward Mark
鈹?  鈹溾攢鈹€ Set Offset Mark
鈹?  鈹溾攢鈹€ Set Leeward Mark / Gate
鈹?  鈹斺攢鈹€ Orbit Mark
鈹溾攢鈹€ Display
鈹?  鈹溾攢鈹€ Brightness Profile: Day / Night / Power Save
鈹?  鈹溾攢鈹€ Brightness: 0..100%
鈹?  鈹斺攢鈹€ Theme: High Contrast / Night
鈹溾攢鈹€ Units: kn / nm / deg
鈹斺攢鈹€ System: Logger / GNSS / Mag / Battery / About
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
- Repeat: after long press, emit every 150鈥?50ms.
- 涓嶄娇鐢ㄧ粍鍚堥敭銆?
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
鈹溾攢鈹€ ui.h / ui.c
鈹溾攢鈹€ ui_model.h
鈹溾攢鈹€ ui_styles.h / ui_styles.c
鈹溾攢鈹€ ui_format.h / ui_format.c
鈹溾攢鈹€ ui_topbar.h / ui_topbar.c
鈹溾攢鈹€ ui_compass.h / ui_compass.c
鈹溾攢鈹€ ui_start.h / ui_start.c
鈹溾攢鈹€ ui_mark.h / ui_mark.c
鈹溾攢鈹€ ui_finish.h / ui_finish.c
鈹斺攢鈹€ ui_settings.h / ui_settings.c
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

LCD 涓嶉渶瑕?E-ink 鐨勫眬鍒枫€佹姉娈嬪奖鎴栧畾鏈熷叏鍒枫€傞〉闈唬鐮佷粛搴?鈥渃reate once, update only鈥濓紝璁?LVGL 鑷繁澶勭悊 invalidation銆?
| Data / Event | UI update frequency / behavior |
|---|---:|
| Heading | P0 鍏?2鈥?Hz锛涘鏁板瓧鎶栧姩锛屾樉绀哄眰鍋?0.3鈥?.5s smoothing |
| SOG / COG / VMG / Drift | 2鈥?Hz锛涙樉绀哄€煎彲 0.3鈥?.0s smoothing |
| Countdown | 1Hz exact锛涚璺冲彉蹇呴』鍑?|
| Topbar GNSS / REC | 1Hz |
| Battery | 0.1Hz 鎴栫數閲忓彉鍖栨椂 |
| Button feedback | immediate锛?50ms 鍐呰瑙夊弽棣?|
| Settings menu | input event only |
| Warning enter/exit | immediate锛涘彲鐢?1鈥? 娆＄煭闂儊锛屼笉鎸佺画闂睆 |

Recommended LVGL behavior:

| Object group | Update rule |
|---|---|
| Topbar labels | 鏂囨湰鍙樺寲鏃舵洿鏂?|
| Large value labels | 鏁板€煎彉鍖栬秴杩囨樉绀虹簿搴︽椂鏇存柊 |
| Warning badges | 鐘舵€佸彉鍖栨椂鏇存柊 text + style |
| Page containers | 椤甸潰鍒囨崲鏃?show/hide锛屼笉 delete/recreate |
| Theme / brightness | 閫氳繃缁熶竴 style/theme 鍑芥暟閲嶈 |

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

1. Compass steady heading: heading 350掳 -> 010掳 wraparound.
2. Start Ready: preset 5:00, SOG 3.6, LINE -18m.
3. Start Active Burn: countdown 23s, SOG 3.0, LINE 5m, TTL 11s, BURN +12s.
4. Start Active Late: countdown 10s, LINE -40m, TTL 25s, LATE 15s.
5. Match Pre-Box: countdown 4:23, BOX in 0:23, BOX BURN +8s.
6. Mark approach: DTG 0.42nm -> 80m, VMG positive.
7. Mark warning: `KEEP MARK TO PORT`.
8. Finish approach: TTL valid, ANG +8掳.
9. NOFIX: top bar `NOFIX`, GNSS fields `--`.
10. MAG LOW: heading confidence 45%, foot `MAG LOW`.
11. Logger fail: `RECx` inverted.
12. LCD profile switch: DAY -> NIGHT -> POWER_SAVE.

---

# 12. Vibe Coding Prompt

```text
浣犳槸宓屽叆寮?GUI 宸ョ▼甯堛€傝鏍规嵁 `sailsiq_lvgl_ui_spec_v1_1_lcd.md` 鐢熸垚 LVGL 9.x C 浠ｇ爜銆?
纭€ц姹傦細
1. 鐩爣鍒嗚鲸鐜囧浐瀹?400x300锛屾í灞?LCD锛涗笉瑕佸啓 E-ink 灞€鍒枫€佹畫褰辨垨瀹氭湡鍏ㄥ埛閫昏緫銆?2. 涓嶈鏀?main.c 鐨?LVGL/SDL 鍒濆鍖栵紝鍙敓鎴?main/ui/ 鐩綍浠ｇ爜銆?3. 椤甸潰鍖呮嫭 Compass銆丼tart銆丮ark銆丗inish銆丼ettings/Calibration銆?4. 鎵€鏈夐〉闈?create once锛泆pdate 鏃跺彧鏀?label text/style/hidden锛屼笉瑕佹瘡绉掗噸寤哄璞°€?5. 鏍峰紡闆嗕腑鍦?ui_styles.c銆?6. 浣跨敤鑻辨枃鐭爣绛撅紱UI 鍙娇鐢ㄩ粦/鐧?鐏帮紝WARN/DANGER 蹇呴』鐢ㄦ枃瀛椼€佸弽鐧姐€佺矖杈规鍖哄垎銆?7. 鐢?ui_model_t 浣滀负鍞竴 UI 鏁版嵁杈撳叆銆?8. 鎻愪緵 mock data锛岃 PC simulator 涓嶆帴浼犳劅鍣ㄤ篃鑳界湅鍒板姩鎬侀〉闈€?9. 鎸夐敭杈撳叆鐢ㄧ粺涓€ ui_handle_button(btn, press)銆?10. 缂栬瘧鐩爣涓?LVGL 9.x锛涘鏈?LVGL 8 鍏煎宸紓锛岀敤瀹忓寘瑁呫€?11. LCD 鑳屽厜/浜害椹卞姩涓嶈鍐欐鍦ㄩ〉闈㈤噷锛屽彧淇濈暀 ui_set_brightness_profile() 鎺ュ彛銆?
鍏堝彧鐢熸垚锛歶i_model.h銆乽i.h銆乽i.c銆乽i_styles.h銆乽i_styles.c銆乽i_format.h銆乽i_format.c銆乽i_topbar.c/h銆乽i_compass.c/h銆乽i_start.c/h銆?涓嶈涓€娆℃€х敓鎴?Mark/Finish/Settings锛岀瓑绗竴鎵圭紪璇戦€氳繃鍐嶇户缁€?```

Second-round prompt:

```text
鐜板湪鍦ㄥ凡缂栬瘧閫氳繃鐨勫熀纭€涓婏紝缁х画鐢熸垚 ui_mark.c/h銆乽i_finish.c/h銆乽i_settings.c/h銆?淇濇寔鍜岀幇鏈?style/object/update 妯″紡涓€鑷达紝涓嶈閲嶆瀯宸插伐浣滅殑鏂囦欢銆?```

---

# 13. Acceptance Criteria

## P0 UI

- [ ] 400脳300 妯℃嫙鍣ㄥ惎鍔ㄥ苟鏄剧ず Compass銆?- [ ] PAGE 鐭寜寰幆 Compass -> Start -> Mark -> Finish銆?- [ ] PAGE 闀挎寜杩涘叆 Settings銆?- [ ] Start Ready 鍙敤 +/- 璋冩暣棰勮鏃堕棿銆?- [ ] ACTION 鐭寜浠?Ready 杩涘叆 Active銆?- [ ] Start Active 姣忕鍒锋柊鍊掕鏃躲€?- [ ] Burn / Late / TTL / Line 鐢?mock data 姝ｇ‘鍙樺寲銆?- [ ] Mark 鏄剧ず Heading / SOG / VMG / Drift / DTG / BRG / ETA銆?- [ ] Finish 鏄剧ず Heading / VMG / SOG / Drift / DTG / TTL / Angle銆?- [ ] NOFIX銆丮AG LOW銆丷EC fail 鏈夋槑纭樉绀恒€?- [ ] LCD 鏃ラ棿楂樺姣旀ā寮忓彲璇伙紱WARN/DANGER 鍚屾椂鍏峰鏂囧瓧銆佸弽鐧芥垨绮楄竟妗嗘彁绀恒€?- [ ] ACTION 闀挎寜鍙垏鎹寒搴?profile锛屾垨鍦?debug build 涓Е鍙?redraw銆?- [ ] 涓嶄緷璧栬Е鎽搞€?
## Engineering

- [ ] UI 浠ｇ爜涓嶅寘鍚紶鎰熷櫒椹卞姩閫昏緫銆?- [ ] UI 鏁版嵁鍙€氳繃 `ui_model_t` 娉ㄥ叆銆?- [ ] 椤甸潰瀵硅薄 create once锛寀pdate only銆?- [ ] 鏍峰紡闆嗕腑绠＄悊銆?- [ ] 鏍煎紡鍖栧嚱鏁伴泦涓鐞嗐€?- [ ] mock data 鍜岀湡瀹炴暟鎹簮鍙垏鎹€?- [ ] LCD driver/backlight code 涓嶅啓鍦ㄩ〉闈㈡枃浠朵腑銆?- [ ] LVGL 9 缂栬瘧閫氳繃銆?
---

# 14. Open Questions

| ID | Question | Recommended default |
|---|---|---|
| Q1 | 鐪熸満 LCD 鎺ュ彛涓庤壊娣辨槸 RGB/SPI/QSPI锛?| UI 鍏堟寜 LVGL `lv_color_t` 鎶借薄锛屼笉鍦ㄩ〉闈唬鐮佺粦瀹氶┍鍔?|
| Q2 | 鐪熸満鍒嗚鲸鐜囨槸鍚︿粛涓?400脳300锛?| 鍏堜繚鐣?400脳300锛涜嫢鍙樻洿锛岄噸绠楀潗鏍囧父閲?|
| Q3 | 澶ф暟瀛楀瓧浣撴槸鍚﹀凡鏈夛紵 | 鍏堢敤 Montserrat锛屽悗缁崲鑷畾涔?digit font |
| Q4 | Start Active 鏄惁缁х画鏄剧ず Heading锛?| 褰撳墠 GUI 涓嶆樉绀猴紝P0 涓嶆樉绀猴紱鍚庣画鍙敤 AC 鍒囨崲瀛楁 |
| Q5 | Finish 搴曢儴鐢?ETA 杩樻槸 TTL锛?| 浼樺厛 TTL锛涙棤鍙潬 TTL 鏃堕€€鍥?ETA |
| Q6 | `TURNS` 鏄惁 P0锛?| 闈?P0锛屼繚鐣欏瓧娈典絾榛樿闅愯棌 |
| Q7 | Settings 鍙充晶璧涘満鍥炬槸鍚﹀繀椤诲姩鎬侊紵 | P0 鍙潤鎬?绠€鍖?|
| Q8 | Match Start 鏄惁绗竴鐗堝仛瀹岋紵 | 鏁版嵁缁撴瀯淇濈暀锛沀I 绗竴鐗堝厛 Fleet锛岀浜岀増琛?Match |
| Q9 | 澶滈棿涓婚鏄惁 P0锛?| P0 鍙仛 brightness profile锛屽畬鏁村闂翠富棰樺彲 P1 |

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
鎸夌収 spec 鐢熸垚 LVGL 9 UI锛屽彧鐢熸垚 main/ui/ 鏂囦欢锛屼笉瑕佸啓椹卞姩锛屼笉瑕侀噸鏋?main.c銆?```

Bad request:

```text
甯垜鍋氬畬鏁?SailSIQ 鍥轰欢銆?```

Recommended iteration:

1. Generate Compass + Topbar only.
2. Compile simulator.
3. Add Start Ready + Active.
4. Add buttons.
5. Add Mark / Finish.
6. Add Settings.
7. Connect real `ui_model_t`.
