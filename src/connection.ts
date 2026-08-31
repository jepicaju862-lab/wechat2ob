// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { SERVICE_PRODUCT } from "./model";
export function parseConnection(raw: string): {endpoint: string; apiToken: string} {
  if (raw.length > 16384) throw new Error("本机连接文件过大");
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error("本机连接文件不是有效 JSON"); }
  if (value?.format !== 1 || value?.product !== SERVICE_PRODUCT) throw new Error("不是 WeChat2Ob 独立服务的连接文件；没有读取旧插件配置");
  let u: URL;
  try { u = new URL(value.endpoint); } catch { throw new Error("本机连接地址无效"); }
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new Error("自动连接只接受 127.0.0.1 本机服务");
  if (typeof value.apiToken !== "string" || !value.apiToken.trim() || value.apiToken.length > 8192 || /[\r\n\0]/.test(value.apiToken)) throw new Error("本机 Token 无效");
  return {endpoint:u.origin,apiToken:value.apiToken.trim()};
}
export async function localConnection() {
  const root = process.platform === "win32" && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA,"WeChat2ObInbox") : process.platform === "darwin" ? path.join(os.homedir(),"Library/Application Support/WeChat2ObInbox") : "";
  if (!root) throw new Error("一键连接目前支持 Windows 和 Mac");
  const file = path.join(root,"connection.json");
  try {
    if ((await fs.stat(file)).size > 16384) throw new Error("连接文件过大");
    return parseConnection(await fs.readFile(file,"utf8"));
  } catch(error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("请先安装 WeChat2Ob 收件服务并扫码；旧多维表格服务不会被自动接管");
    throw error;
  }
}
