// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import { createHash } from "node:crypto";

export const PLUGIN_ID = "wechat2ob";
export const SERVICE_PRODUCT = "wechat2ob-inbox";
export interface Attachment { id: string; kind: string; filename: string; mimeType: string; byteSize: number; sha256: string; }
export interface Message {
  id: string; sourceMessageId: string; seq: string; senderId: string; recipientId: string;
  sessionId: string; kind: string; title: string; content: string; transcript: string;
  receivedAt: string; attachments: Attachment[];
}
export interface Health { ok: boolean; serviceVersion: string; accountConfigured: boolean; messageCount: number; }
export interface InboxClient {
  endpoint: string;
  test(clientId: string): Promise<Health>;
  listMessages(clientId: string, limit?: number): Promise<Message[]>;
  acknowledge(clientId: string, ids: string[]): Promise<number>;
  downloadAttachment(id: string): Promise<ArrayBuffer>;
}
export interface Settings {
  endpoint: string; root: string; notes: boolean; bases: boolean; duowei: boolean;
  autoSync: boolean; intervalSeconds: number;
  noteMode: "daily" | "file"; dailyFolder: string; fixedNotePath: string; noteTimeZone: string;
  duoweiPath: string; duoweiMode: "managed" | "mapped";
  duoweiTableId: string; duoweiFieldMap: Record<string,string>;
}
export const DEFAULT_SETTINGS: Settings = {
  endpoint: "http://127.0.0.1:7342", root: "WeChat2Ob", notes: true, bases: true,
  duowei: false, autoSync: false, intervalSeconds: 3,
  noteMode: "daily", dailyFolder: "日记", fixedNotePath: "微信收件箱.md", noteTimeZone: "local",
  duoweiPath: "", duoweiMode: "managed", duoweiTableId: "", duoweiFieldMap: {}
};
export interface VaultPort {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  write(path: string, content: string): Promise<void>;
  process(path: string, fn: (text: string) => string): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{files: string[]; folders: string[]}>;
  readBinary(path: string): Promise<ArrayBuffer>;
  createBinary(path: string, content: ArrayBuffer): Promise<void>;
  parseYaml?(text: string): unknown;
  stringifyYaml?(value: unknown): string;
}
export interface SavedAttachment { id: string; path: string; kind: string; mimeType: string; sha256: string; }
export interface Journal {
  format: 1; key: string; message: Message; attachments: SavedAttachment[];
  receipts: Record<string, { path: string; at: string }>; received: string;
  noteWrites?: Record<string, { beforeHash: string; afterHash: string; beforeLength: number; addition: string }>;
}
export interface SyncResult { fetched: number; completed: number; acknowledged: number; failed: number; errors: string[]; backupRoot?: string; }

export const hash = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");
// Obsidian SecretStorage accepts lowercase letters, digits and hyphens, at most 64 characters.
// Keep the consumer ID unchanged: changing it would reset the service's ACK namespace.
export const tokenSecretId = (clientId: string): string => "wechat2ob-token-" + hash(clientId).slice(0,32);
export const messageKey = (endpoint: string, message: Message): string => hash(endpoint + "\n" + message.id);
export function vaultPath(value: string): string {
  const text = value.trim();
  if (!text || text.length > 180 || /[\\:\x00-\x1f<>"|?*#\[\]]/.test(text) || text.startsWith("/")) throw new Error("收件目录必须是库内相对路径，不能含特殊字符");
  if (text.split("/").some(part => !part || part.startsWith(".") || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("不能使用隐藏目录、系统保留名或越界路径");
  return text;
}
export function normalizeEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("服务地址不是有效 URL"); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash) throw new Error("远程服务必须使用 HTTPS；地址不能包含账号、密码、查询参数或片段");
  return url.toString().replace(/\/+$/, "");
}
export function settingsFrom(raw: Partial<Settings> | null): Settings {
  const s = {...DEFAULT_SETTINGS, ...(raw || {})};
  return validateSettings(s);
}
export function validateSettings(s: Settings): Settings {
  if (![s.notes,s.bases,s.duowei,s.autoSync].every(v=>typeof v === "boolean")) throw new Error("输出开关无效");
  if (!s.notes && !s.bases && !s.duowei) throw new Error("至少选择一种输出");
  if (!Number.isInteger(s.intervalSeconds) || s.intervalSeconds < 3 || s.intervalSeconds > 3600) throw new Error("同步间隔须为 3～3600 秒");
  if (s.noteMode!=="daily" && s.noteMode!=="file") throw new Error("笔记写入方式无效");
  const dailyFolder=s.dailyFolder.trim()?vaultPath(s.dailyFolder):"";
  const fixedNotePath=vaultPath(s.fixedNotePath);
  if (!fixedNotePath.toLowerCase().endsWith(".md")) throw new Error("指定笔记必须是库内 .md 文件");
  const noteTimeZone=s.noteTimeZone.trim();
  try { new Intl.DateTimeFormat("en",{timeZone:noteTimeZone==="local"?undefined:noteTimeZone}).format(); }
  catch { throw new Error("日记时区无效，请填写 local、Asia/Shanghai 或有效 IANA 时区"); }
  if (!noteTimeZone) throw new Error("日记时区不能为空");
  if(typeof s.duoweiPath!=="string" || typeof s.duoweiTableId!=="string" || !["managed","mapped"].includes(s.duoweiMode))throw new Error("表格目标设置无效");
  const duoweiPath=s.duoweiPath.trim()?vaultPath(s.duoweiPath):"";
  if(duoweiPath && !duoweiPath.toLowerCase().endsWith(".duowei"))throw new Error("表格目标必须是库内 .duowei 文件；指定笔记路径仅用于 .md");
  if(!s.duoweiFieldMap || typeof s.duoweiFieldMap!=="object" || Array.isArray(s.duoweiFieldMap) || Object.entries(s.duoweiFieldMap).some(([key,id])=>!["title","content","type","attachments","transcript","received","sender","session","message","status","note"].includes(key)||typeof id!=="string"||id.length>200))throw new Error("表格字段映射无效");
  if(s.duowei && s.duoweiMode==="mapped" && (!duoweiPath || !s.duoweiTableId || !s.duoweiFieldMap.content))throw new Error("请先选择已有表格，读取字段并映射正文；完成后保存设置");
  return {...s, root:vaultPath(s.root), endpoint:normalizeEndpoint(s.endpoint),dailyFolder,fixedNotePath,noteTimeZone,duoweiPath,duoweiFieldMap:{...s.duoweiFieldMap}};
}
export function validateMessage(value: unknown): Message {
  if (!value || typeof value !== "object") throw new Error("消息格式无效");
  const m = value as Message;
  for (const key of ["id","sourceMessageId","seq","senderId","recipientId","sessionId","kind","title","content","transcript","receivedAt"] as const) {
    if (typeof m[key] !== "string" || m[key].length > 2_000_000) throw new Error("消息字段无效：" + key);
  }
  if (!/^[a-f\d-]{8,64}$/i.test(m.id) || !m.sourceMessageId || !/^\d{4}-\d\d-\d\dT/.test(m.receivedAt) || !Number.isFinite(Date.parse(m.receivedAt))) throw new Error("消息标识或时间无效");
  if (!Array.isArray(m.attachments) || m.attachments.length > 100) throw new Error("附件列表无效");
  const ids = new Set<string>();
  for (const a of m.attachments) {
    if (!a || !/^[a-f\d-]{8,64}$/i.test(a.id) || ids.has(a.id) || typeof a.filename !== "string" || typeof a.kind !== "string" || typeof a.mimeType !== "string" || !Number.isSafeInteger(a.byteSize) || a.byteSize < 1 || a.byteSize > 100*1024*1024 || !/^[a-f\d]{64}$/i.test(a.sha256)) throw new Error("附件元数据无效或超过 100 MB");
    ids.add(a.id);
  }
  return m;
}
export function safeFilename(name: string): string {
  let clean = name.replace(/[\\/:*?"<>|#\[\]\x00-\x1f]/g, "_").replace(/\.{2,}/g,"_").replace(/[. ]+$/g, "").slice(-75);
  if (!clean || clean.startsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) clean = "file_" + clean;
  return clean;
}
