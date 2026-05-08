# Backend Validation V2 progress

Workers should update this file with a short completion note when a task is done. Keep entries brief and include the PR number or commit if useful.

| Task | Status | Completion note |
| --- | --- | --- |
| 1. ConfigurationOptionId | Done | Completed in commit 2d6a1f24 (`Add ConfigurationOptionId typing`). |
| 2. FableType | Done | Implemented FableType with full support for str, int, float, date, datetime, enumClosed, enumOpen, and list types with comprehensive unit tests. |
| 3. Plugin FableType migration | Done | Migrated plugin catalogue `value_type` strings to canonical `FableType` syntax and verified the affected plugin tests. |
| 4. Backend conversion | Not started | |
| 5. Missing values during validation | Not started | |
| 6. BlockExpansion contract | Not started | |
| 7. Test plugin restrictions | Not started | |
| 8. Missing glyph warnings | Not started | |
| 99. Leftovers | Not started | |

## Notes for workers

- Update only the row for the task you completed unless coordinating a multi-task PR.
- If a task intentionally leaves follow-up work, mention it here and in the relevant task document if the non-goal changes.
- If a task has frontend-visible impact, update `backend-validationV2-frontendImpact.md` in the same PR.
