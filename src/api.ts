// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import {validateMessage,type Journal,type Settings,type VaultPort} from "./model";
import {notePath} from "./notes";
import {duoweiPath} from "./duowei";

// Read-only view of this plugin's own journals for other plugins (e.g. Home Pages).
// Contract: docs/HOME_PAGES_API.md. Other plugins must not read state/ directly.
export interface ApiMessage {
  key: string; kind: string; title: string; content: string; transcript: string; receivedAt: string;
  notePath?: string; tablePath?: string;
  attachments: {path: string; kind: string; mimeType: string}[];
}
export interface ApiInbox {
  messages: ApiMessage[];
  today: number; week: number; attachments: number; pending: number | null;
  todayNotePath: string; tablePath: string; inboxRoot: string;
}
export interface QueryOptions { days?: number; limit?: number; kinds?: string[]; }
export interface WeChat2ObApi {
  version: 1;
  query(options?: QueryOptions): Promise<ApiInbox>;
  sync(): Promise<void>;
  openInbox(): Promise<void>;
}
export const READY_EVENT="wechat2ob:ready";
export const SYNCED_EVENT="wechat2ob:synced";

const DAY=86400000;
const int=(value:unknown,min:number,max:number,fallback:number)=>typeof value==="number"&&Number.isFinite(value)?Math.min(max,Math.max(min,Math.floor(value))):fallback;

export class InboxIndex {
  private journals: Promise<Journal[]> | null=null;
  constructor(private vault:VaultPort, private stateRoot:string) {}
  /** Call after any sync: journals are only written by this plugin's engine. */
  invalidate() { this.journals=null; }
  private load():Promise<Journal[]> {
    const loading=this.journals ??= this.read();
    loading.catch(()=>{ if(this.journals===loading)this.journals=null; });
    return loading;
  }
  private async read():Promise<Journal[]> {
    if(!await this.vault.exists(this.stateRoot)) return [];
    const result:Journal[]=[];
    // Every endpoint stream, so history survives an endpoint change.
    for(const stream of (await this.vault.list(this.stateRoot)).folders.filter(p=>/\/[a-f\d]{64}$/.test(p))) {
      for(const file of (await this.vault.list(stream)).files.filter(p=>/\/[a-f\d]{64}\.json$/.test(p))) {
        try {
          const j=JSON.parse(await this.vault.read(file)) as Journal;
          if(j.format!==1 || typeof j.key!=="string")continue;
          validateMessage(j.message);
          result.push({...j,attachments:Array.isArray(j.attachments)?j.attachments:[],receipts:j.receipts&&typeof j.receipts==="object"?j.receipts:{}});
        } catch { /* An unreadable journal is skipped here; the engine reports it on sync. */ }
      }
    }
    return result;
  }
  async query(s:Settings, options:QueryOptions={}, now=Date.now()):Promise<ApiInbox> {
    const days=int(options.days,0,3650,14),limit=int(options.limit,1,200,50);
    const kinds=Array.isArray(options.kinds)?options.kinds.filter(k=>typeof k==="string"):[];
    const midnight=new Date(now);midnight.setHours(0,0,0,0);
    const since=days>0?now-days*DAY:0,weekSince=now-7*DAY;
    let today=0,week=0,attachments=0;
    const messages:(ApiMessage&{time:number})[]=[];
    for(const j of await this.load()) {
      const time=Date.parse(j.message.receivedAt);
      if(time>=midnight.getTime())today++;
      if(time>=weekSince)week++;
      attachments+=j.attachments.length;
      if(since && time<since)continue;
      if(kinds.length && !kinds.includes(j.message.kind))continue;
      const receipts=Object.entries(j.receipts);
      const m=j.message;
      messages.push({
        time,key:j.key,kind:m.kind,title:m.title,content:m.content,transcript:m.transcript,receivedAt:m.receivedAt,
        notePath:receipts.find(([key,r])=>key.startsWith("notes:")&&r.path?.endsWith(".md"))?.[1].path,
        tablePath:receipts.find(([key,r])=>key.startsWith("duowei:")&&r.path?.endsWith(".duowei"))?.[1].path,
        attachments:j.attachments.map(a=>({path:a.path,kind:a.kind,mimeType:a.mimeType}))
      });
    }
    messages.sort((a,b)=>b.time-a.time);
    return {
      messages:messages.slice(0,limit).map(({time:_time,...message})=>message),
      today,week,attachments,pending:await this.pending(s),
      todayNotePath:s.notes||s.bases?notePath(s,new Date(now).toISOString()):"",
      tablePath:s.duowei?duoweiPath(s):"",inboxRoot:s.root
    };
  }
  /** Rows this plugin added (rec_w2o_*) whose status is still “待整理”. */
  private async pending(s:Settings):Promise<number|null> {
    if(!s.duowei)return null;
    const path=duoweiPath(s),statusId=s.duoweiMode==="mapped"?s.duoweiFieldMap.status:"fld_w2o_status";
    if(!statusId || !await this.vault.exists(path))return null;
    try {
      const doc=JSON.parse(await this.vault.read(path));
      const field=Array.isArray(doc?.fields)?doc.fields.find((f:any)=>f?.id===statusId):null;
      if(!field || !Array.isArray(doc.records))return null;
      const option=Array.isArray(field.options)?field.options.find((o:any)=>o?.name==="待整理")?.id:undefined;
      return doc.records.filter((r:any)=>typeof r?.id==="string"&&r.id.startsWith("rec_w2o_")&&[r.values?.[statusId]].flat().some((v:unknown)=>v==="待整理"||(option!==undefined&&v===option))).length;
    } catch { return null; }
  }
}
