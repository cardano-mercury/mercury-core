---
'@cardano-mercury/core': patch
---

Pinned three vulnerable transitive dependencies through `overrides`: `undici` to `^6.27.0` (a high
severity advisory), `ip-address` to `^10.1.1`, and `esbuild` to `^0.25.0`. That clears all fourteen
advisories `npm audit` reported against core's tree.

There was no upgrade path. `undici` and `ip-address` arrive through `@meshsdk/core`, `esbuild` through
`drizzle-kit`, and both parents are already on their latest release, so there was nothing to bump.
`npm audit fix` proposes `@meshsdk/core@1.5.25` and `drizzle-kit@0.18.1`, which are **downgrades** from
the 1.9.1 and 0.31.10 we run: it will walk you backwards to find a tree it can satisfy. `overrides` is
the right instrument.

Verified rather than assumed, because core parses Cardano addresses with MeshJS and forcing a major
bump of its HTTP stack is exactly the kind of thing that breaks quietly: with and without the
overrides, `resolveRewardAddress` returns the identical stake address for a real mainnet base address,
and enterprise addresses (which have no staking part) behave identically.

**This does not protect a consuming app.** npm honours `overrides` only from the root project and
ignores them inside a dependency's `package.json`. Any app that installs `@meshsdk/core`, which is a
peer dependency of core so every Mercury app does, still resolves `undici@5.29.0` in its own tree and
needs its own `overrides` block.
