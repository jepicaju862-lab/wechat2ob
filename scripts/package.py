# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 peyote
"""Optional deterministic local ZIP; never includes service or internal docs."""
import json
import pathlib
import sys
import zipfile

root = pathlib.Path.cwd()
version = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["version"]
if sys.argv[1:] != [version]:
    raise SystemExit("Version must match manifest.json")
files = ["main.js", "manifest.json", "styles.css", "LICENSE", "NOTICE",
         "LICENSE_SCOPE.md", "README.md", "README.zh-CN.md", "THIRD_PARTY_NOTICES.md",
         "docs/使用指南.md", "docs/CLIENT_API.md", "RELEASING.md", "RELEASE_NOTES.md"]
output = root / "dist" / f"WeChat2Ob-{version}.zip"
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        source = root / name
        if source.is_symlink() or not source.is_file():
            raise SystemExit(f"Not a regular file: {name}")
        info = zipfile.ZipInfo("wechat2ob/" + name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, source.read_bytes())
with zipfile.ZipFile(output) as archive:
    assert archive.namelist() == ["wechat2ob/" + name for name in files]
    assert archive.testzip() is None
    for name in files:
        assert archive.read("wechat2ob/" + name) == (root / name).read_bytes()
print(f"Verified {len(files)} client/license/documentation files in {output.name}")
