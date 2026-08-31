[English](README.en.md) | [简体中文](README.md)

# WeChat2Ob

An independent Obsidian desktop plugin that saves messages from a compatible
WeChat inbox service as Markdown notes, Obsidian Bases views and `.duowei` tables.

**Version:** 0.1.7 · **Minimum Obsidian:** 1.11.4 · **Author:** peyote ·
**License:** [GPL-3.0-only](LICENSE) ·
**Website:** [peyote.info/plugins/wechat2ob](https://peyote.info/plugins/wechat2ob/)

> **Client only.** This repository holds the Obsidian plugin. Receiving real
> messages also requires the inbox service, which is licensed under the same
> GPL-3.0-only terms but distributed separately, with its complete corresponding
> source inside each package; see [Inbox service](#inbox-service). Installing this
> plugin alone does not connect to WeChat, and no upstream availability is promised.

## Features

| Output | Behavior | Requirement |
| --- | --- | --- |
| Markdown | Append to a daily note or one selected `.md` file | Obsidian |
| Bases | Index receiving notes, one row per file | Obsidian core Bases |
| `.duowei` | One row per message; create a table or map existing fields | Compatible viewer for visual editing |

- Save text, images, files, video and voice attachments, including transcripts
  already supplied by the service. Audio conversion is a service responsibility.
- Preserve existing note text and table fields, records and views. The first write
  to a mapped table creates a backup.
- Verify attachment size and SHA-256, keep local progress, retry incomplete writes
  and acknowledge a message only after all selected outputs succeed.
- Keep settings, Token storage and client progress separate from other plugins.
  No Duowei Table Pro activation or runtime is required by this client.

The interface is currently in Simplified Chinese. The plugin does not import the
full WeChat database, capture all friends' conversations, send automatic replies
or perform general speech recognition. Mobile execution is not supported.

## Install

Download `main.js`, `manifest.json` and `styles.css` from the same
[GitHub Release](https://github.com/jepicaju862-lab/wechat2ob/releases).
Create `<vault>/.obsidian/plugins/wechat2ob/`, copy the three files there, reload
Obsidian and enable **WeChat2Ob** in Community plugins. The source-code archive
is for building, not a ready-to-install plugin. Community-directory submission
is separate; this repository does not claim approval or listing.

For upgrades, replace only program files and preserve `data.json`, `state/` and
the device's SecretStorage. Back up the vault before testing.

## Inbox service

The inbox service is distributed separately and is not part of this repository.
It is free software under the same **GPL-3.0-only** terms as the plugin: every
package ships its complete corresponding source under `src/` and `installer/`,
together with `LICENSE` and `NOTICE`.

| Platform | Download (Baidu Netdisk) |
| --- | --- |
| Windows 10/11 x64 | [WeChat2Ob-Inbox-0.1.1-win32-x64.zip](https://pan.baidu.com/s/1BtqNJD_6_JkYKz7wWOIS2A?pwd=qrq3) · access code `qrq3` |
| macOS 13.5+ Apple silicon | [WeChat2Ob-Inbox-0.1.1-darwin-mac-arm64.zip](https://pan.baidu.com/s/1fSEEcyGH7eYJZtLfwpG6Og?pwd=sdt2) · access code `sdt2` |
| macOS 13.5+ Intel | [WeChat2Ob-Inbox-0.1.1-darwin-mac-x64.zip](https://pan.baidu.com/s/14-kprOxIZI6z6Qv7yFG7ww?pwd=5tsb) · access code `5tsb` |

Service version 0.1.1. Each package bundles the official Node.js 24.20.0 runtime,
so no separate Node.js, Python, FFmpeg or Docker install is needed. Read `先读我.md`
inside the archive before installing. The installers are not commercially signed or
Apple-notarized, and the macOS packages have not completed hardware acceptance
testing.

## Connect and use

1. Obtain and set up a compatible inbox service separately. If you do not have
   one, the plugin cannot receive real WeChat messages.
2. If an existing WeChat2Ob service is installed locally, select
   **自动连接本机服务**. It reads only the local `WeChat2ObInbox/connection.json`.
   Otherwise expand manual connection, enter the endpoint and save its API Token.
3. Choose daily notes or a fixed Markdown file. Enable Bases and/or `.duowei`
   if needed, then select **保存设置**.
4. Select **立即同步** or enable automatic sync. Successful automatic local
   connection enables automatic sync; a fresh install starts with it disabled.

The default endpoint is `http://127.0.0.1:7342`. Remote services require HTTPS.
Run only one upstream inbox service for a given ClawBot. An existing compatible
service can be entered manually; the plugin does not read another plugin's
configuration or take over its login.

Messages append by their received date in the chosen time zone. Bases still
needs Markdown source notes when the Markdown toggle is off. Switching outputs
or paths affects later deliveries, not an automatic replay of acknowledged history.
See the [Chinese user guide](docs/使用指南.md) and [HTTP contract](docs/CLIENT_API.md).

## Data and privacy

The plugin makes authenticated HTTP requests only to the inbox endpoint configured
by the user: health, message listing, attachments and acknowledgements. It has no
telemetry, analytics, advertising, software activation requests or automatic code
downloads. It does not send vault note bodies to the service. Requests disclose
the client identifier and acknowledged message identifiers to that service.

The API Token is stored in Obsidian SecretStorage, not plugin `data.json`.
`state/` contains message bodies and recovery information and must be treated as
private. Do not publish Tokens, connection files, messages, attachments, logs or
vault backups when reporting issues. Use synthetic, redacted reproductions.

## Develop

Use Node.js 24.14+ and npm. Python 3.11+ is needed only for the optional local ZIP.

```sh
npm ci
npm run verify
npm run package
```

`verify` runs the publication boundary check, TypeScript check, build inspection
and plugin tests. Tests use a loopback-only synthetic fixture, not the production
backend or a WeChat login. No backend dependency install is needed.
`package` additionally produces `dist/WeChat2Ob-0.1.7.zip` for local installation;
GitHub Releases publish only the three standard plugin assets. Each release
points to its complete corresponding source at the matching Git tag.
See [RELEASING.md](RELEASING.md).

## License and support

Copyright (C) 2026 peyote. Licensed under **GPL-3.0-only**, with no warranty.
The plugin is free and has no paid activation. Its API Token is service
authentication, not a plugin license key. See [license scope](LICENSE_SCOPE.md)
and [third-party notices](THIRD_PARTY_NOTICES.md). The license does not grant
rights to the separately distributed backend or other products.

[Issues](https://github.com/jepicaju862-lab/wechat2ob/issues) ·
[Plugin website](https://peyote.info/plugins/wechat2ob/) ·
[peyote.info](https://peyote.info/) · QQ group: `1094620986` ·
[Email](mailto:jepicaju862@gmail.com)

This is an independent third-party project, not an official Obsidian or Tencent
product.
