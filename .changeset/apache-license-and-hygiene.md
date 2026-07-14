---
'@cardano-mercury/core': patch
---

Corrected the license metadata. `package.json` declared MIT while the repository has always shipped
Apache-2.0, so the published package advertised the wrong license. It is now `Apache-2.0`, matching
the LICENSE file and the other Mercury repositories, and the LICENSE's copyright placeholder is filled
in for Cardano Mercury, Inc. Also adds `engines` (Node 22 or newer), `author`, keywords, and
`sideEffects: false` so bundlers can tree-shake the barrels.
