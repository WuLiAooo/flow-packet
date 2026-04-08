# Config Table Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make large XML/XLSX config tables open and search quickly by switching from full-document loading to paged server-side queries and patch-based saves.

**Architecture:** The Go backend will stream XML/XLSX rows to answer paged queries and column-scoped searches without materializing the full dataset in renderer memory. The React renderer will treat the opened file as metadata plus the current page of rows, keep unsaved row patches locally, and save only edited rows back to XML or the active XLSX sheet.

**Tech Stack:** Go backend, React 19, TypeScript, existing websocket request layer, `excelize`, XML decoder streaming, existing Shadcn popover/command primitives.

---

## File Map

- Modify: `apps/server/internal/api/config_table.go`
- Modify: `apps/server/internal/api/config_table_test.go`
- Modify: `apps/server/internal/api/handler.go`
- Modify: `apps/renderer/src/services/configTable.ts`
- Modify: `apps/renderer/src/components/config-table/configTableDocument.js`
- Modify: `apps/renderer/src/components/config-table/configTableDocument.d.ts`
- Modify: `apps/renderer/scripts/config-table-document.test.mjs`
- Modify: `apps/renderer/src/components/config-table/ConfigTablePage.tsx`

## Execution Order

1. Add backend tests for paged open, column/all-column search, and patch-based save.
2. Implement backend paged query and search handlers plus patch save support.
3. Add renderer helper tests for patch merging and save-request generation.
4. Refactor the config-table page to page rows, search server-side, and save row patches only.
5. Run backend tests, helper tests, and renderer build.
