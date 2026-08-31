// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import {hash,type Journal,type Settings,type VaultPort} from "./model";

// Read-only compatibility with the old format. New notes never contain these markers.
export const SECTION_START="<!-- wechat2ob:section:start -->";
export const SECTION_END="<!-- wechat2ob:section:end -->";
export const NOTE_TAG="#wechat2ob/inbox";
export const messageMarker=(key:string)=>`<!-- wechat2ob:message:${key} -->`;
export const noteReference=(path:string)=>path;
// Keep the receipt key stable so upgrading never re-appends completed messages.
export const noteReceipt=(path:string)=>`notes:append-v2:${path}`;

export function messageDate(receivedAt:string,timeZone:string):{date:string;time:string} {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timeZone==="local"?undefined:timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(receivedAt));
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return {date:`${value.year}-${value.month}-${value.day}`,time:`${value.hour}:${value.minute}:${value.second}`};
}
export function notePath(s:Settings,receivedAt:string):string {
  return s.noteMode==="file"?s.fixedNotePath:`${s.dailyFolder?s.dailyFolder+"/":""}${messageDate(receivedAt,s.noteTimeZone).date}.md`;
}
export function literal(text:string):string {
  return text.replace(/\r\n?/g,"\n").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/([\\`*_{}\[\]()#+.!|~-])/g,"\\$1");
}
export function messageSection(j:Journal):string {
  const parts:string[]=[];
  if(j.message.content.trim())parts.push(literal(j.message.content));
  if(j.message.transcript.trim() && j.message.transcript!==j.message.content)parts.push(literal(j.message.transcript));
  for(const a of j.attachments) {
    const embed=["image/png","image/jpeg","image/gif","image/webp","audio/wav","audio/mpeg","audio/mp4","video/mp4","video/webm"].includes(a.mimeType);
    parts.push(`${embed?"!":""}[[${a.path}]]`);
  }
  return parts.join("\n\n") || "（此消息没有文字或附件）";
}
function addition(text:string,j:Journal):string {
  const eol=text.includes("\r\n")?"\r\n":"\n";
  const gap=!text||text.endsWith(eol+eol)?"":text.endsWith(eol)?eol:eol+eol;
  return gap+messageSection(j).replace(/\n/g,eol)+eol;
}
class ConcurrentNoteEdit extends Error {}

export async function appendMessage(vault:VaultPort,path:string,j:Journal,checkpoint:()=>Promise<void>):Promise<void> {
  if(path.includes("/"))await vault.mkdir(path.slice(0,path.lastIndexOf("/")));
  for(let attempt=0;attempt<3;attempt++) {
    const exists=await vault.exists(path),text=exists?await vault.read(path):"";
    const pending=j.noteWrites?.[path];
    if(pending) {
      if(!/^[a-f\d]{64}$/.test(pending.beforeHash) || !/^[a-f\d]{64}$/.test(pending.afterHash) || !Number.isSafeInteger(pending.beforeLength) || pending.beforeLength<0 || typeof pending.addition!=="string" || !pending.addition.length)throw new Error("笔记写入日志损坏，未重复追加");
      // Offset + original prefix distinguish identical messages. Later user appends are allowed.
      if(hash(text)===pending.afterHash || (hash(text.slice(0,pending.beforeLength))===pending.beforeHash && text.slice(pending.beforeLength,pending.beforeLength+pending.addition.length)===pending.addition))return;
      if(hash(text)!==pending.beforeHash)throw new Error(`笔记 ${path} 的上次写入结果需要核对：中断后正文已变化，已暂停此消息以避免重复；请保留笔记及 state 日志`);
    } else {
      if(text.split(/\r?\n/).includes(messageMarker(j.key)))return;
      const chunk=addition(text,j);
      (j.noteWrites??={})[path]={beforeHash:hash(text),afterHash:hash(text+chunk),beforeLength:text.length,addition:chunk};
      await checkpoint(); // Persist the intent before touching the user's note.
    }
    const intent=j.noteWrites![path];
    try {
      if(!exists) {
        try { await vault.create(path,intent.addition); }
        catch(error) {
          if((error as {code?:string})?.code==="EEXIST" || (error instanceof Error && /file.*exists|文件.*已存在|^exists$/i.test(error.message)))throw new ConcurrentNoteEdit();
          // A create can fail after writing. Keep its intent for recovery instead of re-appending.
          throw error;
        }
      } else await vault.process(path,latest=>{
        if(hash(latest)!==intent.beforeHash)throw new ConcurrentNoteEdit();
        return latest+intent.addition;
      });
      return;
    } catch(error) {
      if(!(error instanceof ConcurrentNoteEdit))throw error;
      // This attempt did not write. Re-plan against the latest user edit.
      delete j.noteWrites![path];await checkpoint();
    }
  }
  throw new Error("笔记正在被连续编辑，未追加消息；稍后自动重试");
}
