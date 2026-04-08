# Begin Runtime Design

## Scope
- Remove the `ENTRY` eyebrow text from the Begin node card.
- Capture `playerInfo.roleId` and `playerInfo.allianceId` when a login session receives `GcPlayerInfo`.
- Show these values only in the Begin property panel for the current runtime session.
- Clear the values on logout or when the session leaves the ready state.

## Design
- Store role runtime data in `sessionStatusStore`, keyed by `connectionId::deviceId`.
- Update runtime data from the shared `packet.received` subscription so the logic stays centralized.
- Keep the Begin node canvas data unchanged to avoid persisting runtime values with saved canvases.
- Surface `roleId` and `allianceId` as read-only copyable fields in the Begin property sheet.

## Verification
- Renderer build must pass.
- Manual flow: login Begin node, receive `GcPlayerInfo`, open Begin properties, verify values and copy actions, then logout and verify fields are cleared.
