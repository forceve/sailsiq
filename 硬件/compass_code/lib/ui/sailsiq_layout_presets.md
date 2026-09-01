# SailSIQ UI Layout Presets

Date: 2026-05-10

## Principle

The device is not a touch screen device. The firmware must not expose drag, resize, or free-coordinate layout editing.

All supported layouts are firmware presets. The settings page only lets the user choose which preset each page uses. The SD card stores long-term preset choices, not object coordinates.

## Persistent Config

The UI layer stores one preset id per configurable page:

```c
#define UI_LAYOUT_CONFIG_MAGIC   0x514C4955u
#define UI_LAYOUT_CONFIG_VERSION 1u
#define UI_LAYOUT_CONFIG_PAGE_COUNT 4u

typedef struct {
    uint32_t magic;
    uint16_t version;
    uint16_t size;
    uint8_t page_preset[UI_LAYOUT_CONFIG_PAGE_COUNT]; /* Compass, Start, Mark, Finish */
    uint32_t crc32;
} ui_layout_config_t;
```

Recommended SD paths:

```text
/sailsiq/config/ui_layout_v1.bin
/sailsiq/config/ui_layout_v1.bak
```

Load and save rules:

- Load after LVGL screen objects are created and before the first user-facing page is shown.
- Validate `magic`, `version`, `size`, page preset ranges, and `crc32`.
- Fall back to firmware defaults if validation fails.
- Save only on an explicit user save action, not on every button press.
- The platform SD layer should write a temporary file, flush, and rename it to the final config path.
- The UI layer exposes weak hooks for platform storage: `ui_layout_storage_load(ui_layout_config_t *config)` and `ui_layout_storage_save(const ui_layout_config_t *config)`.
- The platform implementation should call `ui_layout_config_validate()` after reading, or let `ui_apply_layout_config()` validate before applying.

## Settings Page

Settings adds:

```text
Page Layout
```

The new Layout page:

```text
Layout
  Compass
  Start
  Mark
  Finish
  Save to SD
  Reset Page
  Reset All
```

Selecting a page opens that page's preset list in the same left panel:

```text
Compass
  Classic
  Big Heading
  Tactical 4
```

Start uses:

```text
Start
  Classic
  Pace Focus
  Line Focus
  Match
```

The right panel previews the preset under the cursor. Its lower half shows a scaled-down main-card layout, while the text above it only lists what the footer will contain. On the left panel, the current applied preset is shown as black background with white text. The cursor selection is shown as a black circle marker with normal black text on white background; if the cursor is on the current preset, the circle remains visible and the row keeps the current inverse style.

Button behavior:

- `+/-`: move the cursor in the current list.
- `ACTION` on Compass / Start / Mark / Finish: open that page's preset list.
- `ACTION` on a preset: apply it to the current page. The page stays open so the current marker can be checked.
- `ACTION` on Save: call the platform storage save hook.
- `ACTION` on Reset Page: reset the current target page to its default preset.
- `ACTION` on Reset All: reset all page presets to firmware defaults.
- `ACTION long`: reset the current target page.
- `PAGE`: return from a preset list to the page/action list, or return to Settings from the page/action list.
- `PAGE long`: save layout config, then return to the previous main page.

## Preset Definitions

### Compass

- `Classic`: Heading large, SOG + Drift below. This is the existing layout.
- `Big Heading`: Heading uses the whole main card. SOG / Drift / VMG move to the bottom bar.
- `Tactical 4`: Heading / Drift / SOG / VMG as a 2x2 grid.

### Start

- `Classic`: Heading in the upper half, Timer in the lower half. Other data goes to the bottom bar.
- `Pace Focus`: Burn/Late in upper-left, TTL in upper-right, Timer in the lower half. Other data goes to the bottom bar.
- `Line Focus`: Line distance in upper-left, TTL in upper-right, Timer in the lower half. Other data goes to the bottom bar.
- `Match`: reserved and currently blank.

### Mark

Mark reuses the Compass presets. Mark-specific navigation data goes to the bottom bar.

- `Classic`: Heading large, SOG + Drift below.
- `Big Heading`: Heading uses the whole main card.
- `Tactical 4`: Heading / Drift / SOG / VMG as a 2x2 grid.

Bottom bar examples: `DTG`, `BRG`, `ETA`, rounding side, or approach lock.

### Finish

Finish reuses the Compass presets. Finish-specific navigation data goes to the bottom bar.

- `Classic`: Heading large, SOG + Drift below.
- `Big Heading`: Heading uses the whole main card.
- `Tactical 4`: Heading / Drift / SOG / VMG as a 2x2 grid.

Bottom bar examples: `DTG`, `TTL`, `ANG`, finish line state.
