# WeChat2Ob 0.1.7

First public **client-only** source distribution, dated 2026-08-31.

- Save inbox messages to daily or fixed Markdown notes, Bases views and optional
  `.duowei` tables while keeping local progress independent from other clients.
- Map existing table fields, including text, single-select and multi-select type
  and status columns. Preserve existing fields, records and views.
- Preserve user-edited notes, verify attachments and retry incomplete writes.
- Publish plugin source, synthetic tests and independent build scripts under
  **GPL-3.0-only**, Copyright (C) 2026 peyote.
- Production backend source, backend binaries/installers, credentials and runtime
  data are deliberately excluded. A separately obtained service remains required
  for real messages; this release does not provide a public backend download.

Desktop test release; Obsidian 1.11.4 or newer. Interface: Simplified Chinese.
No claim of community directory approval. No mobile execution or general speech
recognition. Plugin behavior and ID remain compatible with the existing 0.1.7
client; this publication does not migrate user data or change service licensing.

Install the three assets into `.obsidian/plugins/wechat2ob/`. Preserve `data.json`,
`state/` and SecretStorage when upgrading. The Git tag matching `manifest.json`
contains the full corresponding plugin source, build scripts, LICENSE and NOTICE.

## 中文

首次公开仅含插件的源码，版本保持 0.1.7。支持 Markdown、Bases 和可选 `.duowei` 输出，
保留已有笔记、表格与独立同步进度；支持已有表格的类型、状态单选/多选字段映射。
统一采用 GPL-3.0-only，署名 peyote；不含生产后端源码、安装包、密钥或运行数据。
真实收件仍需另行取得兼容服务，本次不提供公开后端下载，也未提交官方社区审核。

发布资产只有 `main.js`、`manifest.json`、`styles.css`。升级时保留配置、私人日志和密钥。
