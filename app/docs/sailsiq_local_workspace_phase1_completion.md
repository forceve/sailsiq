# SailSIQ Local Workspace Phase 1 Completion

Date: 2026-04-01
Status: Complete enough to start Phase 2

## Purpose

This document records what Phase 1 actually delivered in code, what decisions are now fixed, and what later phases must treat as infrastructure rather than open design.

Phase 1 was focused on local workspace setup, browser-bound directory access, workspace state management, and a first usable import entry in Settings. It did not attempt to complete the local session bundle flow.

## Phase 1 Outcome

Phase 1 is considered functionally complete.

Delivered:

- Workspace creation from a chosen parent folder
- Workspace reuse from an existing local directory
- Stable browser-side workspace binding with persisted directory handles
- Current workspace selection and restore flow
- Permission recheck / regrant flow
- Workspace scan and discovery summary
- Workspace-centric Home view
- Settings-based workspace setup and manager
- Settings-based data import entry for track and video files
- Copy / cut import modes
- Import progress UI

Not part of Phase 1:

- Local session creation flow
- Session index persistence beyond the workspace manifest placeholder
- New Session local import pipeline
- Replay local read/write bundle flow
- `bindings.json`-driven asset closure

## Fixed Product Decisions

These decisions are no longer provisional for upcoming development.

### 1. Phase 1 entry point lives in Settings

During Phase 1, workspace setup is intentionally hosted in Settings instead of being the first screen of the app.

This includes:

- Create Workspace
- Use Existing Workspace
- Workspace Manager
- Import Data

Future phases may promote workspace setup to a stronger app entry, but current code should treat Settings as the supported Phase 1 entry point.

### 2. Default workspace name

The default new workspace name is fixed to:

`SailSIQWorkspace`

### 3. Workspace creation flow

Workspace creation follows this rule:

1. User selects a parent directory.
2. SailSIQ creates a new child folder using the workspace name.
3. That child folder becomes the workspace root.

This is important. The app does not assume the user directly selects the final workspace root when creating a new workspace.

### 4. Workspace file layout

Phase 1 initializes the workspace with this structure:

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
  cache/
  index/
```

For user-facing guidance in the current product:

- Track files go to `incoming/track`
- Video files go to `incoming/video`

### 5. Browser storage responsibility

The workspace directory is the business truth source.

Browser local storage is only used for:

- persisted `FileSystemDirectoryHandle`
- current workspace id
- remembered workspace registry
- permission recovery state
- scan/discovery cache and small runtime state

Phase 1 does not treat browser storage as the primary source of session or asset truth.

### 6. Filesystem-first rule

Phase 1 confirms the architecture direction:

- workspace files and JSON metadata are the source of truth
- browser storage is only for binding and cache
- raw track files and raw video files are not stored in browser databases

### 7. Stable origin assumption

Workspace binding is browser-origin scoped.

This implementation assumes:

- production will run on a stable origin
- `localhost` is only a development environment

Future work must preserve this assumption and should not design around changing origins.

### 8. Permission loss is a normal product state

Directory permission loss is not treated as an exceptional architecture failure.

The product must support:

- permission recheck
- regrant flow
- workspace reuse after permission degradation

## Implemented Code Areas

Phase 1 is represented mainly by these files:

- `app/frtend/src/services/workspace/localWorkspace.ts`
- `app/frtend/src/context/WorkspaceContext.tsx`
- `app/frtend/src/pages/SettingsPage.tsx`
- `app/frtend/src/pages/HomePage.tsx`
- `app/frtend/src/App.tsx`
- `app/frtend/src/types/workspace.ts`
- `app/frtend/src/types/filesystem-access.d.ts`

## Functional Notes

### Workspace binding

Local workspace binding is implemented with:

- File System Access API
- IndexedDB for directory handles
- localStorage for current workspace and registry metadata

### Import flow

The current import flow in Settings is:

1. Open Import Data dialog
2. Choose target: `track` or `video`
3. Choose mode: `copy` or `cut`
4. Select files
5. Review selected files
6. Import into the current workspace

Current destinations:

- `track` -> `incoming/track`
- `video` -> `incoming/video`

### Large file handling

Phase 1 import now writes selected files with a streamed path where possible, instead of forcing the entire file through a single in-memory buffer. This matters for large video files.

### Cut mode behavior

`cut` is best-effort in the browser environment.

Behavior:

- import is attempted first
- source deletion is attempted afterward if the browser exposes deletion on the picked file handle
- if deletion is not available, the app keeps the imported copy and reports a warning

This behavior is intentional and should remain explicit in UI and code.

### Open Folder behavior

In the pure browser build, "Open Folder" does not launch the system file explorer.

In Phase 1 it means:

- activate / use the remembered workspace in-browser
- confirm the bound directory is available for this origin

Direct OS-level folder launching is a future desktop-shell enhancement, not a browser guarantee.

## What Phase 2 Can Assume

Phase 2 may assume the following infrastructure already exists:

- a current workspace can be resolved globally
- a workspace directory handle can be restored
- permissions can be re-requested
- workspace discovery can be rescanned
- the app has a stable place for incoming track and video files
- Settings already exposes a user-facing import entry

## What Phase 2 Must Build Next

Recommended next work:

1. Local session model and file layout under `sessions/<sessionId>/`
2. New Session must support two equal entry paths:
   selecting already-discovered files from the current workspace, and selecting local files from outside the workspace through the OS file picker
3. When a session is created from local files outside the workspace, the product must support an explicit save-to-workspace option, such as a checkbox, so the created session and its source files can be archived into the workspace automatically
4. Writing `session.json`, `track.json`, `events.json`, `marks.json`, and later `bindings.json`
5. Home page session listing from local workspace data
6. Replay page must at least open and read workspace-backed sessions exposed from Home; full workspace-backed writes remain a later step

Phase 2 should not be described as "workspace-first" in the sense of removing the file picker path.

The intended model is:

- users can create from files that already exist inside the workspace, without reopening the OS file picker
- users can still use local files outside the workspace through the OS file picker
- when creating from those files, the UI should expose whether the session should also be saved into the workspace and whether the source files should be copied into the workspace

For boundary clarity:

- once Home exposes local workspace sessions, Replay cannot stay remote-only for initial loading
- Phase 2 should therefore include a local-read fallback so workspace sessions can be opened without hitting `Session not found`
- full local writeback for events, marks, offset, and asset relocation still belongs to the next Replay-focused phase

## Non-Goals Confirmed by Phase 1

Phase 1 intentionally did not solve:

- cloud publish / sync
- multi-device conflict resolution
- organization permissions
- full asset relocation and broken-reference recovery
- desktop-shell file explorer integration

Those remain later-phase concerns.

## Summary

Phase 1 established the local workspace infrastructure and browser interaction model. The project now has a stable foundation for local-first development. Future work should build on this infrastructure rather than reopening the setup, binding, or workspace ownership model.
