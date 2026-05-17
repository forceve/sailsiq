# SailSIQ App Page Spec

> Updated for the navigation refactor implemented on 2026-04-09.

## 1. Core Views

The current app exposes six primary views:

1. `Sessions` home: workspace status and session list
2. `New Session`: import or create a session
3. `Canvas Workspace`: session-scoped manual editing mode
4. `Replay Workspace`: session-scoped review and analysis mode
5. `Export / Share`: session-scoped delivery mode
6. `Settings`: global preferences and workspace setup

## 2. Navigation Structure

### 2.1 Global Navigation

Global navigation is intentionally small:

* Tabs: `Sessions`, `Settings`
* Primary action: `New Session`
* Rule: global navigation must not guess a session target from "most recent" or any fallback lookup

This keeps global IA focused on where the user is in the product, not what step they are on inside a specific session.

### 2.2 Session Navigation

Session-scoped pages share a second-level tab group:

* `Replay`
* `Canvas`
* `Export`

Rules:

* Session tabs always stay bound to the current explicit `sessionId`
* Session switching happens from the Sessions list, not from the top navbar
* `Settings` remains a utility destination, not a session tab

## 3. Page Requirements

### 3.1 Sessions Home

Purpose:

* Entry point for the current workspace
* Show workspace permission / scan / discovery status
* List available sessions and let the user explicitly enter one

Required UI:

* Global navigation with `Sessions`, `Settings`, and `New Session`
* Workspace summary and status actions
* Session cards with explicit entry into `Replay` or `Canvas`
* Empty, loading, and error states

### 3.2 New Session

Purpose:

* Create a session from imported track data or start a canvas session

Required UI:

* Session metadata form
* Creation mode switch: `Import Data` / `Canvas Mode`
* Parse preview and validation feedback for imported files
* Create action that routes into the correct session workspace

Notes:

* `New Session` is a primary action, not part of the global tab set
* Canvas creation flows into the session-scoped `Canvas Workspace`

### 3.3 Canvas Workspace

Purpose:

* Manual session editing for path, marks, and wind setup

Required UI:

* Session tabs: `Replay / Canvas / Export`
* Back-to-sessions control
* Drawing tools for path / mark / selection
* Save action and editing detail panel

### 3.4 Replay Workspace

Purpose:

* Primary analysis surface for playback, charts, timeline, marks, and video

Required UI:

* Session tabs: `Replay / Canvas / Export`
* Back-to-sessions control
* Utility access to `Settings`
* Map, timeline, side panels, chart/stat surfaces

### 3.5 Export / Share

Purpose:

* Session delivery and sharing

Required UI:

* Session tabs: `Replay / Canvas / Export`
* Export format selection
* Export options and preview
* Progress and completion states

### 3.6 Settings

Purpose:

* Global preferences, workspace configuration, and privacy controls

Required UI:

* Global navigation with `Sessions`, `Settings`, and `New Session`
* Workspace setup and permission management
* Preference controls

## 4. IA Decisions

* Do not mix global destinations and session workflow tabs in one navbar.
* Do not duplicate `Home / New / Settings` as both tabs and icon buttons in the same header.
* Do not hide `Canvas` from navigation when it is a real route and editing mode.
* Prefer explicit session entry over convenience fallbacks that can open the wrong session context.
