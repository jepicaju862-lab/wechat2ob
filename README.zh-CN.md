[English](README.md) | [简体中文](README.zh-CN.md)

# WeChat2Ob

独立的 Obsidian 微信收件客户端，将兼容收件服务中的消息保存为 Markdown 笔记、
Obsidian Bases 视图和 `.duowei` 表格，三种输出可组合使用。

**版本：0.1.7，桌面测试版** · **最低 Obsidian：1.11.4** · **作者：peyote** ·
**许可：[GPL-3.0-only](LICENSE)** ·
**官网：[peyote.info/plugins/wechat2ob](https://peyote.info/plugins/wechat2ob/)**

> **本次仅开源插件，不开源生产后端。** 仓库和 GitHub Release 不包含微信登录、轮询、
> 媒体解码、后端源码或后端安装包。收取真实消息需要另行获得并运行兼容的收件服务及 API Token。
> 仅安装插件不能直接连接微信。本次没有公开后端下载入口；服务获取方式请联系维护者，
> 不承诺后端何时公开或上游接口始终可用。

## 功能

| 输出 | 实现 | 要求 |
| --- | --- | --- |
| Markdown | 按接收日期追加到日记，或追加到指定 `.md` 文件 | 无需多维表格插件 |
| Bases | 汇总收件笔记，每个文件一行 | 启用 Obsidian 核心 Bases |
| `.duowei` | 每条消息一行；新建表格或映射已有字段 | 可视化查看需要兼容插件 |

- 支持文字、图片、文件、视频、语音附件及服务已有转写；音频转换由独立服务负责。
- 保留已有笔记正文、属性及表格字段、记录和视图；首次写入映射表格前自动备份。
- 校验附件大小和 SHA-256，持久化记录进度，失败可重试，全部输出成功后再确认消息。
- 插件 ID、设置、Token 和客户端进度独立，不读取其他插件配置，不依赖多维表格商业授权。

不扫描完整微信数据库，不同步普通好友的所有聊天记录，不自动回复，不提供通用语音识别。
当前界面为简体中文；仅支持桌面端运行，文件可通过用户自己的库同步方式在手机查看。

## 安装

从同一个 [GitHub Release](https://github.com/jepicaju862-lab/wechat2ob/releases)
下载 `main.js`、`manifest.json`、`styles.css`，放入：

```text
<你的库>/.obsidian/plugins/wechat2ob/
```

重新加载 Obsidian，在“设置 → 第三方插件”中启用 WeChat2Ob。自动生成的 Source code
压缩包用于开发，需要先构建；本次没有宣称已经上架或通过官方社区审核。

升级仅替换程序文件，保留本插件 `data.json`、`state/` 和本设备 SecretStorage。
请先备份并在测试库试用，不覆盖其他插件目录。

## 连接与使用

1. 另行取得并配置兼容的收件服务；没有服务时，插件不能收取真实消息。
2. 本机已安装 WeChat2Ob 服务时，点击 **自动连接本机服务**；它仅读取
   `WeChat2ObInbox/connection.json`。也可展开手动连接，填写地址并保存 API Token。
3. 选择日记或指定 Markdown 文件，按需启用 Bases、`.duowei`，点击 **保存设置**。
4. 点击 **立即同步**，或开启自动同步。初次安装自动同步默认关闭；自动连接成功后会开启。

默认本机地址 `http://127.0.0.1:7342`，远程地址必须使用 HTTPS。
同一个 ClawBot 只运行一个上游收件服务；可以手动连接已有兼容服务，
但不会自动接管其他插件、读取其密钥或搬迁其数据。

消息按接收日期和所选时区写入，正文只追加内容、已有转写与附件，不添加重复标题或隐藏标记。
Bases 需要 Markdown 作为数据源，只开 Bases 时仍会写笔记。
更换路径或输出选项应用于后续消息，不自动重放已确认历史。
详见 [使用指南](docs/使用指南.md) 与 [客户端 HTTP 接口](docs/CLIENT_API.md)。

## 隐私与网络

插件仅请求用户配置的收件服务，获取健康状态、消息和附件，以及提交成功确认。
没有遥测、统计、广告、软件激活请求或自动下载执行代码；不会上传库中笔记正文。
服务能接收到客户端 ID 和被确认的消息 ID。

API Token 保存在 Obsidian SecretStorage，不写入插件 `data.json`。
私人 `state/` 含消息正文及恢复记录，请勿公开。反馈问题时使用合成、脱敏示例，
不要上传 Token、连接文件、微信消息、附件、日志或库备份。

## 开发与构建

需要 Node.js 24.14+ 和 npm。只有可选的本地 ZIP 打包需要 Python 3.11+。

```sh
npm ci
npm run verify
npm run package
```

`verify` 检查公开文件清单、TypeScript、构建输入与插件测试；不安装或测试生产后端。
测试模拟器只在本机回环地址生成合成消息，不连接微信。
`package` 额外生成本地安装包 `dist/WeChat2Ob-0.1.7.zip`。
GitHub Release 与 Side-Comments-origin 一样只发布三个标准插件文件，并提供构建来源证明。
对应标签中的源码和构建脚本构成该版本的完整插件源码。发布步骤见 [RELEASING.md](RELEASING.md)。

## 授权与支持

Copyright (C) 2026 peyote。采用 **GPL-3.0-only**，无担保。
插件免费，没有付费激活、激活码或设备数授权；API Token 是收件服务访问凭据，不是插件许可证。
本次许可不扩展到未公开的后端或其他产品，详见 [授权范围](LICENSE_SCOPE.md) 与
[第三方说明](THIRD_PARTY_NOTICES.md)。

[问题反馈](https://github.com/jepicaju862-lab/wechat2ob/issues) ·
[插件官网](https://peyote.info/plugins/wechat2ob/) ·
[peyote.info](https://peyote.info/) · QQ 群：`1094620986` ·
[邮箱](mailto:jepicaju862@gmail.com)

本项目与 Obsidian、腾讯/微信官方无从属关系。
