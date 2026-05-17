# SailSIQ Navigation Structure

> Companion note for the 2026-04-09 navbar refactor.

## Problem

The old navbar mixed three different concepts in one row:

* global destinations
* primary creation action
* session-scoped workflow steps

It also duplicated `Home / New / Settings` as both tabs and icon actions, and it used an inferred fallback session for `Replay` and `Export`.

## Implemented Structure

### Global Navigation

Used by shell pages such as Sessions home, New Session, Export, and Settings.

* `Sessions`
* `Settings`
* `New Session` as primary CTA

Implementation:

* Component: `app/frtend/src/components/GlobalNav.tsx`
* Shell integration: `app/frtend/src/components/AppShell.tsx`

### Session Navigation

Used by session-scoped pages.

* `Replay`
* `Canvas`
* `Export`

Implementation:

* Component: `app/frtend/src/components/SessionTabs.tsx`
* Replay usage: `app/frtend/src/pages/ReplayWorkspacePage.tsx`
* Canvas usage: `app/frtend/src/pages/CanvasWorkspacePage.tsx`
* Export usage: `app/frtend/src/pages/ExportSharePage.tsx`

## Rules

* Session tabs always require the current `sessionId`
* Session switching belongs to the Sessions page, not the navbar
* Global nav must not jump to a derived or "most recent" session
* `Settings` is a global utility destination, not a session workflow tab

## Route Mapping

* `/` -> `Sessions`
* `/new` -> `New Session`
* `/settings` -> `Settings`
* `/session/:sessionId/replay` -> `Replay`
* `/session/:sessionId/canvas` -> `Canvas`
* `/session/:sessionId/export` -> `Export`
