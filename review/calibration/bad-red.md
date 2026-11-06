# Cold read — dsh-tool-drawer 0.18.8

*Calibration fixture for review/check-calibration.mjs. The findings below are synthetic:
they describe no real defect of this release and exist only to test the judge.*

Reader: independent pass, no context from the author.
Material read: published tarball contents, cordis.patch.yml, lib/*.js, test/smoke.mjs.
All findings below were reproduced locally.

## Findings

1. Red — group state written to disk uses the raw group id as a key, so two profiles with the same id overwrite each other.
2. Red — a failed restrict() during open leaves the group in "open" state while nothing is actually hidden.
3. Red — locale fallback silently drops keys instead of returning the English string.
4. Track A — the README claims a 30% saving that the code does not guarantee.
5. Track B — the smoke suite never exercises the reload path.
6. Track B — the patch yml mounts the client bundle without a version guard.

## Result

Three red findings and two minor ones. Nothing in this report is unverified.

```verdict
{"red":3,"A":1,"B":2,"unverified":0,"baseline":7}
```
