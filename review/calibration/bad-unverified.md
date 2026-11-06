# Cold read — dsh-tool-drawer 0.18.8

*Calibration fixture for review/check-calibration.mjs. The open items below are synthetic:
they describe no real defect of this release and exist only to test the judge.*

Reader: independent pass, no context from the author.
Material read: published tarball contents, cordis.patch.yml, the loader docs, test/smoke.mjs.

## Confirmed

- apply() on a fresh profile hides the documented set of groups.
- The smoke suite completes without errors.

## Could not confirm

1. The claimed token saving on a long session — no long session was available, so the number in the README was not reproduced.
2. The reload path under plugin upgrade — the upgrade was not exercised, the assertion stays open.

## Result

No red findings. Two items remain unverified.

```verdict
{"red":0,"A":0,"B":0,"unverified":2,"baseline":7}
```
