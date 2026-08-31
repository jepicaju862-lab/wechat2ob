// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import type {Journal} from "./model";
import {literal,SECTION_START,SECTION_END} from "./notes";

export function cleanLegacyText(text:string,path:string,journals:Journal[]):{text:string;keys:string[]} {
  const marks=[...text.matchAll(/^<!-- wechat2ob:message:([a-f\d]{64}) -->\r?$/gm)];
  if(!marks.length)return {text,keys:[]};
  const known=new Map(journals.map(j=>[j.key,j]));
  if(marks.some(m=>!known.has(m[1])) || new Set(marks.map(m=>m[1])).size!==marks.length)throw new Error("旧笔记标记存在缺失日志或重复消息，未自动清理");
  const starts=[...text.matchAll(/^<!-- wechat2ob:section:start -->\r?$/gm)],ends=[...text.matchAll(/^<!-- wechat2ob:section:end -->\r?$/gm)];
  if(starts.length!==1 || ends.length!==1 || starts[0].index!>=ends[0].index!)throw new Error("旧收件区域标记不完整，已保留原文");
  const eol=text.includes("\r\n")?"\r\n":"\n";
  const start=starts[0].index!,end=ends[0].index!;
  let prefix=text.slice(0,start),body=text.slice(start+starts[0][0].length+1,end),suffix=text.slice(end+ends[0][0].length);
  if(suffix.startsWith("\n"))suffix=suffix.slice(1);
  const keys:string[]=[];
  body=body.replace(/^<!-- wechat2ob:message:([a-f\d]{64}) -->\r?\n([\s\S]*?)^\^wechat2ob-\1\r?$(?:\r?\n)*/gm,(_all,key:string,content:string)=>{
    const j=known.get(key)!;
    const lines=content.split(/\r?\n/);
    if(/^### \d{4}-\d\d-\d\d \d\d:\d\d:\d\d · (文字|图片|语音|视频|文件|混合|其他|消息)$/.test(lines[0]))lines.shift();
    const sender="发送者："+literal(j.message.senderId.replace(/[\r\n]+/g," "));
    let senderRemoved=false;
    const cleaned=lines.filter(line=>{
      if(!senderRemoved && j.message.senderId && line===sender){senderRemoved=true;return false;}
      if(j.message.transcript && line==="**语音转写**")return false;
      if(!j.message.content && (j.message.transcript||j.attachments.length) && line==="> （此消息没有文字正文）")return false;
      return true;
    }).map(line=>line.startsWith("> ")?line.slice(2):line);
    while(cleaned.length&&!cleaned[0].trim())cleaned.shift();
    while(cleaned.length&&!cleaned[cleaned.length-1].trim())cleaned.pop();
    keys.push(key);return cleaned.join(eol)+eol+eol;
  });
  if(keys.length!==marks.length || body.includes("<!-- wechat2ob:message:"))throw new Error("旧消息边界不完整，已保留原文");
  body=body.replace(/^## 微信收件\r?\n(?:\r?\n)*#wechat2ob\/inbox\r?\n(?:\r?\n)*/,"");
  const basename=path.split("/").pop()!.replace(/\.md$/i,"");
  // Only remove the standalone generated title immediately before the managed area.
  if(prefix.replace(/(?:\r?\n)+$/,"")===`# ${basename}` || prefix.replace(/(?:\r?\n)+$/,"")==="# 微信收件箱")prefix="";
  body=body.replace(/(?:\r?\n)+$/,"")+eol;
  const gap=suffix && !suffix.startsWith(eol)?eol:"";
  return {text:prefix+body+gap+suffix,keys};
}

export function cleanLegacyTableLinks(text:string,notes:Map<string,Set<string>>):string {
  let doc:any;
  try { doc=JSON.parse(text); } catch { return text; }
  if(doc.schemaVersion!==1 || doc.meta?.wechat2ob!==1 || !Array.isArray(doc.records))return text;
  let changed=false;
  for(const record of doc.records) {
    const key=record.values?.fld_w2o_message;
    for(const path of notes.get(key)||[]) {
      if(record.values.fld_w2o_note===`[[${path}#^wechat2ob-${key}]]`) {
        record.values.fld_w2o_note=`[[${path}]]`;changed=true;
      }
    }
  }
  if(!changed)return text;
  doc.meta.revision=(Number.isSafeInteger(doc.meta.revision)?doc.meta.revision:0)+1;
  doc.meta.updatedAt=new Date().toISOString();
  return JSON.stringify(doc,null,2)+"\n";
}
