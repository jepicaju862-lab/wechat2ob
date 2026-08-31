// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import type { Journal, Settings, VaultPort } from "./model";
import { safeFilename } from "./model";
import {appendMessage,notePath,noteReceipt,noteReference} from "./notes";
import {basePath,baseText,indexNotesInBase} from "./bases";
export {basePath} from "./bases";
import {duoweiPath,duoweiReceipt,hasDuoweiReceipt,prepareDuowei,appendDuowei} from "./duowei";
export {newDuowei,appendDuowei,kindNames} from "./duowei";
const now=()=>new Date().toISOString();

export async function prepareRoot(vault: VaultPort, root: string): Promise<void> {
  const marker = `${root}/.wechat2ob-root.json`;
  if (await vault.exists(marker)) {
    let data;
    try { data=JSON.parse(await vault.read(marker)); } catch { throw new Error("收件目录标记损坏，未写入"); }
    if (data.product!=="wechat2ob" || data.format!==1) throw new Error("收件目录属于其他应用，未写入");
    return;
  }
  if (await vault.exists(root)) {
    const existing=await vault.list(root);
    if (existing.files.length || existing.folders.length) throw new Error("收件目录已有其他数据，请选择新的空目录；不会修改旧收件箱");
  }
  await vault.mkdir(root);
  await vault.create(marker,JSON.stringify({product:"wechat2ob",format:1,createdAt:now()}));
}
export async function prepareOutputs(vault: VaultPort, s: Settings): Promise<void> {
  await prepareRoot(vault,s.root);
  if (s.bases) {
    const file = basePath(s);
    if (!await vault.exists(file)) await vault.create(file,baseText());
    // Never rewrite an existing Base: Obsidian may reformat it or the user may customize views.
  }
  if (s.duowei) await prepareDuowei(vault,s);
}
export async function writeOutputs(vault: VaultPort, s: Settings, j: Journal, checkpoint:()=>Promise<void>): Promise<void> {
  let note: string | null=null;
  if (s.notes || s.bases) {
    const path=notePath(s,j.message.receivedAt);
    const receipt=noteReceipt(path);
    note=noteReference(path);
    if (!j.receipts[receipt]) {
      await appendMessage(vault,path,j,checkpoint);
      j.receipts[receipt]={path,at:now()};
      if(j.noteWrites)delete j.noteWrites[path];
      await checkpoint();
    }
    await indexNotesInBase(vault,s,[path]);
  }
  if (s.duowei) {
    const file=duoweiPath(s),receipt=duoweiReceipt(file);
    if (!hasDuoweiReceipt(j,file)) {
      await vault.process(file,text=>appendDuowei(text,j,note,s));
      j.receipts[receipt]={path:file,at:now()};
      await checkpoint();
    }
  }
}
export function attachmentPath(root: string, j: Journal, id: string, filename: string): string {
  return `${root}/附件/${new Date(j.message.receivedAt).toISOString().slice(0,7)}/${j.key.slice(0,16)}-${safeFilename(id)}-${safeFilename(filename)}`;
}
