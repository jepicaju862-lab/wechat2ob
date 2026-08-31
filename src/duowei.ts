// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import {hash,type Journal,type Settings,type VaultPort} from "./model";
export const fieldTypes: Record<string,string> = {title:"text",content:"longText",type:"text",attachments:"attachment",transcript:"longText",received:"dateTime",sender:"text",session:"text",message:"text",status:"text",note:"noteLink"};
export const fieldNames: Record<string,string> = {title:"标题",content:"内容",type:"消息类型",attachments:"附件",transcript:"语音转写",received:"接收时间",sender:"发送者",session:"会话",message:"消息唯一键",status:"状态",note:"笔记"};
export const kindNames: Record<string,string> = {text:"文字",image:"图片",voice:"语音",video:"视频",file:"文件",mixed:"混合",unknown:"其他"};
const fid = (name: string) => `fld_w2o_${name}`;
const now = () => new Date().toISOString();
export function newDuowei(): Record<string,any> {
  const fields = Object.entries(fieldTypes).map(([k,type])=>({id:fid(k),name:fieldNames[k],type,width:k==="content"?320:180,...(["content","transcript"].includes(k)?{markdown:false}:{})}));
  const common = {fieldOrder:fields.map(f=>f.id),hiddenFields:[fid("message")],sorts:[],filters:[],filterConjunction:"and",colorRules:[],collapsedDetailGroups:[]};
  const stamp = now();
  return {schemaVersion:1,id:"tbl_wechat2ob_inbox",name:"WeChat2Ob 微信收件箱",titleFieldId:fid("title"),fields,records:[],views:[
    {...common,id:"view_w2o_grid",name:"全部消息",type:"grid",rowHeight:"default",frozenFieldCount:1,wrapText:true},
    {...common,id:"view_w2o_gallery",name:"附件画廊",type:"gallery",coverFieldId:fid("attachments"),titleFieldId:fid("title"),cardFieldIds:[fid("type"),fid("received"),fid("content")]}
  ],activeViewId:"view_w2o_grid",meta:{createdAt:stamp,updatedAt:stamp,revision:0,writerVersion:9,wechat2ob:1}};
}
export const duoweiPath=(s:Settings)=>s.duoweiPath||`${s.root}/微信收件箱.duowei`;
export const duoweiReceipt=(path:string)=>`duowei:file:${path}`;
// Also recognize old root-based receipts, but only for the same actual target file.
export const hasDuoweiReceipt=(j:Journal,path:string)=>Object.entries(j.receipts).some(([key,r])=>key.startsWith("duowei:")&&r.path===path);
export const compatibleTypes:Record<string,string[]>={title:["text","longText"],content:["text","longText"],type:["text","longText","singleSelect","multiSelect"],attachments:["attachment"],transcript:["text","longText"],received:["dateTime"],sender:["text"],session:["text"],message:["text"],status:["text","longText","singleSelect","multiSelect"],note:["noteLink"]};
export const fieldTypeNames:Record<string,string>={text:"文本",longText:"长文本",singleSelect:"单选",multiSelect:"多选",attachment:"附件",date:"日期",dateTime:"日期时间",noteLink:"笔记链接",number:"数字",checkbox:"勾选",formula:"公式",relation:"关联",lookup:"查找",rollup:"汇总",createdTime:"创建时间",updatedTime:"更新时间",autoNumber:"自动编号"};
const fieldAliases:Record<string,string[]>={content:["正文"],type:["类型"],message:["微信消息 ID","消息 ID"],note:["关联笔记"]};
export function fieldMappingIssue(field:{id:string,type:string},key:string,map:Record<string,string>):string {
  if(!compatibleTypes[key]?.includes(field.type))return "类型不兼容";
  const owner=Object.keys(map).find(other=>other!==key&&map[other]===field.id);
  return owner?`已用于${fieldNames[owner]||owner}`:"";
}
function selectValue(field:any,value:unknown):string|string[] {
  const options=field.options;
  if(!Array.isArray(options)||options.some((o:any)=>!o||typeof o.id!=="string"||!o.id||typeof o.name!=="string")||new Set(options.map((o:any)=>o.id)).size!==options.length)throw new Error(`表格列“${field.name}”的选项结构无效，请检查该列`);
  const matches=options.filter((o:any)=>o.name===value);
  if(matches.length!==1)throw new Error(`表格列“${field.name}”${matches.length?"存在重名":"缺少"}选项“${value}”；请在表内调整选项，或取消此项映射`);
  return field.type==="multiSelect"?[matches[0].id]:matches[0].id;
}

export function inspectDuowei(text:string):Record<string,any> {
  let doc:any;
  try { doc=JSON.parse(text); } catch { throw new Error("目标 .duowei 不是有效 JSON，未覆盖"); }
  if(!doc || doc.schemaVersion!==1 || typeof doc.id!=="string" || !doc.id || !doc.meta || typeof doc.meta!=="object" || Array.isArray(doc.meta) || !Array.isArray(doc.fields) || !Array.isArray(doc.records) || !Array.isArray(doc.views))throw new Error("目标不是支持的独立 .duowei 表格");
  if(doc.meta.writerVersion!==undefined && (!Number.isInteger(doc.meta.writerVersion) || doc.meta.writerVersion>9 || doc.meta.writerVersion<0))throw new Error("表格写入版本不支持，请先升级 WeChat2Ob");
  if(doc.source || doc.readOnly || doc.meta.readOnly)throw new Error("不能写入实时索引或只读表格，请选择可写表格");
  if(doc.fields.some((f:any)=>!f || typeof f.id!=="string" || !f.id || typeof f.name!=="string" || typeof f.type!=="string") || new Set(doc.fields.map((f:any)=>f.id)).size!==doc.fields.length)throw new Error("表格字段结构或 ID 异常，未写入");
  if(doc.records.some((r:any)=>!r || typeof r.id!=="string" || !r.id || !r.values || typeof r.values!=="object" || Array.isArray(r.values)) || new Set(doc.records.map((r:any)=>r.id)).size!==doc.records.length)throw new Error("表格记录结构或 ID 异常，未写入");
  return doc;
}
export function validateDuowei(doc:Record<string,any>,s?:Settings):Record<string,string> {
  if(!s || s.duoweiMode==="managed") {
    if(doc.meta.wechat2ob!==1)throw new Error("目标表格需要字段映射，请选择“已有表格（字段映射）”并读取字段，不会覆盖原表");
    for(const [key,type] of Object.entries(fieldTypes))if(!doc.fields.some((f:any)=>f.id===fid(key)&&f.type===type))throw new Error(`表格字段已删除或改型：${fieldNames[key]}`);
    return Object.fromEntries(Object.keys(fieldTypes).map(key=>[key,fid(key)]));
  }
  if(doc.id!==s.duoweiTableId)throw new Error("目标表格已被替换，请重新读取字段并保存设置，未写入其他表格");
  const map=s.duoweiFieldMap;
  if(!map.content)throw new Error("已有表格必须映射正文到文本或长文本字段");
  const used=new Set<string>();
  for(const [key,id] of Object.entries(map))if(id) {
    if(!compatibleTypes[key] || used.has(id))throw new Error("字段映射重复或无效，每列只能接收一项消息内容");
    const field=doc.fields.find((f:any)=>f.id===id);
    if(!field || !compatibleTypes[key].includes(field.type))throw new Error(`字段映射已失效或类型不兼容：${fieldNames[key]}`);
    if(key==="status" && ["singleSelect","multiSelect"].includes(field.type))selectValue(field,"待整理");
    used.add(id);
  }
  return map;
}
export function suggestFieldMap(doc:Record<string,any>,current:Record<string,string>={}):Record<string,string> {
  const map:Record<string,string>={...current},used=new Set(Object.values(current).filter(Boolean));
  for(const key of Object.keys(fieldTypes)) {
    // Explicit blank selections and manual mappings survive a field refresh.
    if(Object.prototype.hasOwnProperty.call(current,key))continue;
    const candidates=doc.fields.filter((f:any)=>!used.has(f.id)&&compatibleTypes[key].includes(f.type));
    const names=[fieldNames[key],...(fieldAliases[key]||[])];
    const field=names.map(name=>candidates.find((f:any)=>f.name===name)).find(Boolean) || (key==="title"?candidates.find((f:any)=>f.id===doc.titleFieldId):undefined);
    if(field){map[key]=field.id;used.add(field.id);}
  }
  return map;
}
export async function checkDuoweiTarget(vault:VaultPort,s:Settings):Promise<void> {
  const path=duoweiPath(s);
  if(await vault.exists(path))validateDuowei(inspectDuowei(await vault.read(path)),s);
  else if(s.duoweiMode==="mapped")throw new Error("指定的已有表格不存在，请先选择文件并读取字段");
}
export async function prepareDuowei(vault:VaultPort,s:Settings):Promise<void> {
  const path=duoweiPath(s);
  await checkDuoweiTarget(vault,s);
  if(!await vault.exists(path)) {
    if(path.includes("/"))await vault.mkdir(path.slice(0,path.lastIndexOf("/")));
    await vault.create(path,JSON.stringify(newDuowei(),null,2)+"\n");
  }
}
export async function backupMappedTable(vault:VaultPort,stateRoot:string,s:Settings,j:Journal):Promise<void> {
  const path=duoweiPath(s);
  if(!s.duowei || s.duoweiMode!=="mapped" || hasDuoweiReceipt(j,path))return;
  const folder=`${stateRoot}/table-backups/${hash(path+"\n"+s.duoweiTableId)}`;
  const indexPath=folder+"/index.json",backupPath=folder+"/original.duowei";
  if(await vault.exists(indexPath)) {
    const index=JSON.parse(await vault.read(indexPath));
    if(index.source!==path || index.tableId!==s.duoweiTableId || !await vault.exists(backupPath))throw new Error("表格备份记录不完整，未写入");
    return;
  }
  const before=await vault.read(path);
  validateDuowei(inspectDuowei(before),s);
  await vault.mkdir(folder);
  if(!await vault.exists(backupPath))await vault.create(backupPath,before);
  const backup=await vault.read(backupPath);
  if(inspectDuowei(backup).id!==s.duoweiTableId)throw new Error("表格备份不匹配，未写入");
  await vault.create(indexPath,JSON.stringify({format:1,source:path,tableId:s.duoweiTableId,backup:backupPath,sha256:hash(backup),createdAt:now()},null,2)+"\n");
}
export function appendDuowei(text:string,j:Journal,note:string|null,s?:Settings):string {
  const doc=inspectDuowei(text),map=validateDuowei(doc,s);
  const rowId=`rec_w2o_${j.key}`;
  if(doc.records.some((r:any)=>r.id===rowId || (map.message && r.values[map.message]===j.key)))return text;
  const m=j.message;
  const values:Record<string,unknown>={title:m.title,content:m.content,type:kindNames[m.kind]||m.kind,attachments:j.attachments.map(a=>`[[${a.path}]]`),transcript:m.transcript,received:m.receivedAt,sender:m.senderId,session:m.sessionId,message:j.key,status:"待整理",note:note?`[[${note}]]`:""};
  const mapped:Record<string,unknown>=Object.create(null);
  for(const [key,id] of Object.entries(map))if(id) {
    const field=doc.fields.find((f:any)=>f.id===id);
    mapped[id]=["singleSelect","multiSelect"].includes(field.type)?selectValue(field,values[key]):values[key];
  }
  const stamp=now();
  doc.records.push({id:rowId,values:mapped,createdAt:stamp,updatedAt:stamp,revision:0});
  doc.meta.updatedAt=stamp;
  doc.meta.revision=(Number.isSafeInteger(doc.meta.revision)?doc.meta.revision:0)+1;
  // Never add/change existing columns, options, view settings, or records.
  return JSON.stringify(doc,null,2)+"\n";
}
