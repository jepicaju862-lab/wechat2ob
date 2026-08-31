# Third-party notices / 第三方说明

The WeChat2Ob plugin is GPL-3.0-only; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
This file covers the client distribution only.

| Component | Use | License | Included in main.js? |
| --- | --- | --- | --- |
| Obsidian API typings (`obsidian` 1.12.3) | Build-time types; runtime API supplied by Obsidian | MIT (SDK package) | No; `obsidian` is external |
| Node.js built-in modules | Files, paths, hashing and timers supplied by the desktop host | Node.js and component licenses | No; external host modules |
| esbuild 0.20.2 | Development bundler | MIT | No |
| TypeScript 5.9.3 | Development type checker | Apache-2.0 | No |
| `@types/node` 20.19.43 | Development types | MIT | No |

Transitive development dependency versions and license identifiers are recorded
in `package-lock.json`. Their original license files remain in their npm packages;
`node_modules` and the Node.js runtime are not redistributed in plugin releases.
The build verifier rejects bundled inputs outside `src/` and runtime imports
other than Obsidian and Node.js built-ins. If dependencies are bundled in a future
release, review their licenses and include the required notices before release.

The Obsidian application is not distributed here. No runtime code from Duowei
Table Pro is imported or bundled. Generating a `.duowei` file does not license or
include another plugin; displaying that format may require a compatible viewer.

The production backend, its WeChat protocol dependencies and its SILK decoder
are not part of this repository or release. Their existing third-party notices
remain with their separate distributions and are not replaced by this license.

本次第三方说明仅覆盖插件。生产包不内嵌 Obsidian、Node.js 运行时或多维表格插件代码；
微信协议、SILK 解码等后端依赖及其安装包不随本仓库公开。构建依赖保留各自 npm 包内的许可，
新增打包依赖时必须重新核对并保留必要的版权和授权声明。
