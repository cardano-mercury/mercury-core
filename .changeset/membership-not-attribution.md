---
'@cardano-mercury/core': patch
---

`makeOwnershipTest` now documents that it answers membership ("is this address ours?"), not
attribution ("which bucket or account is it?"). One stake key routinely spans several payment
addresses, so labelling an undeclared sibling by its stake key merges things that were deliberately
kept apart, while the totals still balance and nothing catches it. Behaviour is unchanged; the
predicate was never wrong, only under-described.
