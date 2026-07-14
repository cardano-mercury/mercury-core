---
'@cardano-mercury/core': patch
---

Documented the two ways a shared database bites, in the README where the shared-migration conventions
are stated: `drizzle-kit push` applies `tablesFilter` to tables but not to sequences, so it offers to
drop another app's migration journal; and Postgres silently truncates identifiers at 63 characters, so
a drizzle-derived foreign key name over that length drifts permanently and invisibly.
