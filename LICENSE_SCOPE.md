# License scope / 授权范围

Copyright (C) 2026 peyote. The WeChat2Ob plugin code, tests, build scripts,
styles and documentation in this repository are licensed under **GPL-3.0-only**,
unless a file explicitly identifies a third-party license. The complete,
unmodified GPL version 3 text is in [LICENSE](LICENSE); the program notice is
in [NOTICE](NOTICE). It is not an MIT release or a GPL-3.0-or-later release.

The plugin is free to use and does not require a purchase, activation code,
device authorization or license server. An inbox API Token authenticates access
to messages; it is not a software license key. The GPL permits commercial use
subject to its terms. No additional non-commercial restriction is imposed here.

This repository and its release assets contain **only the Obsidian client**.
The production inbox service, WeChat login/polling implementation, media decoder,
installers, deployment configuration, credentials and message databases are
excluded from this repository. The service is licensed under the same
GPL-3.0-only terms and ships its own LICENSE, NOTICE and complete corresponding
source inside each installer package. The plugin communicates with a separately
running service through the documented HTTP interface; it neither imports nor
bundles backend code.
`scripts/mock-service.mjs` is a synthetic test fixture with no WeChat connection,
login or production service code.

This license grants rights to the material distributed here. The separately
distributed inbox service carries its own copy of the same license; this
statement does not change the licenses of Duowei Table Pro, Obsidian or
third-party components. This scope statement does not remove any rights or
obligations under the GPL for covered work. If code is later moved between
components, review its licensing before release rather than assuming HTTP or
directory boundaries alone decide the legal result.

When redistributing the plugin, preserve the copyright and license notices and
meet the GPL's corresponding-source requirements. Official binary releases link
to the matching Git tag, which contains the plugin source and build scripts.
Third-party trademarks remain with their owners; this project is not affiliated
with or endorsed by Obsidian or Tencent/WeChat.

## 中文说明

本仓库插件源码、测试、构建脚本、样式和文档统一采用 **GPL-3.0-only**，
作者署名 **peyote**。第三方组件保留自身许可；完整 GPL v3 原文见 LICENSE。
不采用 MIT，也不添加“仅限非商业”等额外限制。

插件免费，无购买、激活码、设备授权或商业授权服务器。设置中的 API Token 是收件服务的访问凭据，
不是插件激活码。开源插件仍需要可用的独立收件服务才能接收真实微信消息。

本仓库不包含生产后端、微信登录和轮询实现、媒体解码器、安装器、部署配置、密钥或消息数据库；
收件服务单独分发，采用同一套 GPL-3.0-only，安装包内自带 LICENSE、NOTICE 及完整对应源码。
测试模拟器只产生合成消息，不连接微信，不是生产后端的开源版本。
本次许可不改变多维表格产品、Obsidian 或第三方组件的既有授权；
也不免除 GPL 对实际受其覆盖作品规定的义务。以后移动或复用代码时应重新核对许可。
