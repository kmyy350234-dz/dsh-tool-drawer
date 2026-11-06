# Cold read — dsh-tool-drawer 0.18.8

*Calibration fixture for review/check-calibration.mjs.*

Reader: independent pass, no context from the author.
Material read: published tarball contents, cordis.patch.yml, lib/*.js, test/smoke.mjs.
Everything below was reproduced by running the code, not copied from the README.

## Checks

1. Group table and tool names in the shipped bundle match DESIGN.md.
2. apply() hides the documented number of groups on a fresh profile.
3. Opening a group restores exactly its members and leaves no orphan restriction.
4. Closing a group removes only what it added; a second open/close cycle is stable.
5. Unknown group ids and empty views fall back without throwing.
6. Locale strings load for every shipped language.
7. Smoke suite: 128 checks, 0 failures on a clean checkout.
8. No network access, no writes outside os.tmpdir(), no secrets in the package.

## Result

No red findings. Nothing was left unverified: every line above was checked by running it.

```verdict
{"red":0,"A":0,"B":0,"unverified":0,"baseline":7}
```
