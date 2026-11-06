# Cold read — dsh-tool-drawer 0.18.8

*Calibration fixture for review/check-calibration.mjs.*

Reader: independent pass, no context from the author.
Material read: published tarball contents, cordis.patch.yml, lib/*.js, test/smoke.mjs.

## Checks

1. Tool names and group ids match DESIGN.md.
2. apply() hides the documented groups on a fresh profile.
3. Restrict and release round-trip cleanly.
4. Smoke suite: 128 checks, all pass.

## Result

No red findings and nothing unverified. The author of this fixture forgot to append
the machine-readable block, so the judge must treat this report as missing.
