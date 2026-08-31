# Releasing the client

This repository contains only the GPL-3.0-only Obsidian plugin. Do not copy a
mixed development workspace, a backend history, service installers, real vault
fixtures or private configuration into it. `public-files.json` is an explicit
reviewed file list, not an invitation to add private files to pass the check.

## Verification

```sh
npm ci
npm run verify
npm run package
npm run release:check
git diff --exit-code
```

The tracked tree must exactly match `public-files.json`; all required paths must
be regular files. The checker rejects unexpected files, backend paths, common
credential formats, private machine paths and inconsistent license/version
metadata. It is a guardrail, not a complete secret detector: manually review the
entire outgoing commit and history before publishing. Build inputs must be client
sources only, with Obsidian and Node.js host APIs external.

`npm test` uses synthetic loopback HTTP and filesystem fixtures under `.artifacts`.
It does not install, import or test the production backend. The local ZIP includes
the full license and client documentation and is verified against its fixed list.

## GitHub convention

Use the matching semver tag, preferably without `v` (for example `0.1.7`), following
Side-Comments-origin. The manifest, package, lockfile and `versions.json` must agree.
Push the reviewed main commit first and wait for its CI verification before
pushing the version tag. Do not use `--force` or overwrite a published tag.

The tag workflow repeats verification, generates GitHub build attestations and
publishes **only** `main.js`, `manifest.json`, `styles.css`. It links the matching
source tree in the release body. GitHub's automatic source archives include the
client source, build scripts, full LICENSE and NOTICE. Do not attach backend ZIPs,
workspace backups or the optional local installation ZIP to this release.

Before announcing a release, check the public tracked tree, Actions result,
three asset names, manifest version and downloaded SHA-256 values. Verify build
provenance with GitHub CLI when available:

```sh
gh attestation verify main.js --repo jepicaju862-lab/wechat2ob
gh attestation verify manifest.json --repo jepicaju862-lab/wechat2ob
gh attestation verify styles.css --repo jepicaju862-lab/wechat2ob
```

The root `main.js` is generated and ignored; it is not source-controlled. The
public Git tag provides its complete corresponding plugin source. Keep the
license and source reference in the generated banner. The plugin requires a
separate service for real messages; every release must disclose its availability
and avoid implying that the backend is included or open source.

Publishing a GitHub release is separate from submitting to the Obsidian community
directory, changing the website, or publishing another product. None of those
additional actions are performed by this workflow.
