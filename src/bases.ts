// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import type {Settings,VaultPort} from "./model";
export const basePath=(s:Settings)=>`${s.root}/微信笔记.base`;
const tagFilter='file.hasTag("wechat2ob/inbox")';
const pathFilter=(path:string)=>`file.path == ${JSON.stringify(path)}`;
const pathScope=(paths:string[])=>({or:(paths.length?[...new Set(paths)].sort():[""]).map(pathFilter)});
export function baseText(paths:string[]=[]):string {
  const properties={"file.name":{displayName:"日记 / 收件笔记"},"file.folder":{displayName:"所在目录"},"file.mtime":{displayName:"最近修改"},"file.size":{displayName:"文件大小"},"file.tags":{displayName:"标签"}};
  const columns=Object.keys(properties);
  return "# wechat2ob-base-v3\n"+JSON.stringify({filters:{and:['file.ext == "md"',pathScope(paths)]},properties,views:[{type:"table",name:"微信笔记",order:columns},{type:"table",name:"按目录",groupBy:{property:"file.folder",direction:"ASC"},order:columns}]},null,2)+"\n";
}
export function indexBaseText(text:string,paths:string[],vault:VaultPort):string {
  let doc:any;
  try { doc=vault.parseYaml?vault.parseYaml(text):JSON.parse(text.replace(/^#.*\r?\n/,"")); } catch { return text; }
  const and=doc?.filters?.and;
  if(!Array.isArray(and))return text;
  const index=and.findIndex((filter:any)=>filter===tagFilter || (filter && Array.isArray(filter.or) && filter.or.length && filter.or.every((item:any)=>typeof item==="string" && /^file\.path == "(?:[^"\\]|\\.)*"$/.test(item))));
  if(index<0)return text; // User-managed Bases are not taken over.
  const previous=and[index];
  const existing=previous===tagFilter?[]:previous.or.map((item:string)=>JSON.parse(item.slice('file.path == '.length))).filter(Boolean);
  const next=pathScope([...existing,...paths]);
  if(JSON.stringify(previous)===JSON.stringify(next))return text;
  and[index]=next;
  return "# wechat2ob-base-v3\n"+(vault.stringifyYaml?vault.stringifyYaml(doc):JSON.stringify(doc,null,2)+"\n");
}
export async function indexNotesInBase(vault:VaultPort,s:Settings,paths:string[]):Promise<void> {
  if(s.bases)await vault.process(basePath(s),text=>indexBaseText(text,paths,vault));
}
