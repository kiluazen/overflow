# Overflow agent notes

## QA

When Kushal says "check things", QA, or asks if everything works, run
`docs/qa.md` on prod: every row, the real client ids, the shipped build. Update
each row's **Last checked**. When a user-facing bug gets past it, add the row that
would have caught it in the same PR as the fix.
