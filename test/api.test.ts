// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {SyncEngine} from "../src/engine";
import {InboxIndex} from "../src/api";
import {duoweiPath,newDuowei,setProcessedInTable} from "../src/duowei";
import {DEFAULT_SETTINGS,hash,type InboxClient,type Message,type Settings,type VaultPort} from "../src/model";

class MemoryVault implements VaultPort {
  files=new Map<string,string|ArrayBuffer>();
  folders=new Set<string>();
  reads=0;
  async exists(p:string){return this.files.has(p)||this.folders.has(p);}
  async read(p:string){this.reads++;const text=this.files.get(p);if(typeof text!=="string")throw new Error("not text: "+p);return text;}
  async readBinary(p:string){const b=this.files.get(p);if(!(b instanceof ArrayBuffer))throw new Error("not binary");return b;}
  async create(p:string,text:string){if(this.files.has(p))throw new Error("exists");this.files.set(p,text);}
  async write(p:string,text:string){this.files.set(p,text);}
  async process(p:string,fn:(t:string)=>string){this.files.set(p,fn(await this.read(p)));}
  async createBinary(p:string,b:ArrayBuffer){this.files.set(p,b);}
  async mkdir(p:string){const parts=p.split('/');for(let i=1;i<=parts.length;i++)this.folders.add(parts.slice(0,i).join('/'));}
  async list(p:string){const immediate=(v:string)=>v.startsWith(p+'/')&&!v.slice(p.length+1).includes('/');return {files:[...this.files.keys()].filter(immediate),folders:[...this.folders].filter(immediate)};}
}
const bytes=new TextEncoder().encode('png bytes').buffer;
class FakeClient implements InboxClient {
  endpoint="http://127.0.0.1:7342";
  pending:Message[]=[];
  async test(){return {ok:true,serviceVersion:"0.1.0",accountConfigured:true,messageCount:this.pending.length};}
  async listMessages(){return this.pending.slice();}
  async acknowledge(_id:string,ids:string[]){this.pending=this.pending.filter(m=>!ids.includes(m.id));return ids.length;}
  async downloadAttachment(){return bytes;}
}
const message=(overrides:Partial<Message>={}):Message=>({id:randomUUID(),sourceMessageId:randomUUID(),seq:"1",senderId:"user",recipientId:"bot",sessionId:"chat",kind:"text",title:"",content:"测试内容",transcript:"",receivedAt:new Date().toISOString(),attachments:[],...overrides});
const state='.obsidian/plugins/wechat2ob/state';

async function synced(settings:Settings,messages:Message[]) {
  const vault=new MemoryVault(),client=new FakeClient();
  client.pending=messages;
  const result=await new SyncEngine(vault,state,"wechat2ob-api-test").sync(client,settings);
  assert.equal(result.failed,0,result.errors.join("; "));
  return {vault,index:new InboxIndex(vault,state)};
}

test("query summarizes journals newest first with receipts, attachments and filters",async()=>{
  const now=Date.now();
  const image={id:"a1b2c3d4",kind:"image",filename:"photo.png",mimeType:"image/png",byteSize:bytes.byteLength,sha256:hash(new Uint8Array(bytes))};
  const s:Settings={...DEFAULT_SETTINGS,duowei:true};
  const {index}=await synced(s,[
    message({content:"最新文字",receivedAt:new Date(now-60_000).toISOString()}),
    message({kind:"voice",content:"",transcript:"下午开会",receivedAt:new Date(now-120_000).toISOString()}),
    message({kind:"image",content:"",attachments:[image],receivedAt:new Date(now-180_000).toISOString()}),
    message({content:"很久以前",receivedAt:new Date(now-30*86400000).toISOString()})
  ]);
  const inbox=await index.query(s,{days:14,limit:10,kinds:[]},now);
  assert.deepEqual(inbox.messages.map(m=>m.kind),["text","voice","image"],"old message outside days filter");
  assert.equal(inbox.week,3);
  assert.ok(inbox.today>=0 && inbox.today<=3);
  assert.equal(inbox.attachments,1);
  assert.equal(inbox.pending,4,"every managed table row starts as 待整理");
  assert.equal(inbox.messages[1].transcript,"下午开会");
  assert.equal(inbox.messages[0].sessionId,"chat");
  assert.equal(inbox.messages[0].senderId,"user");
  assert.match(inbox.messages[0].notePath??"",/^日记\/\d{4}-\d\d-\d\d\.md$/);
  assert.equal(inbox.messages[0].tablePath,"WeChat2Ob/微信收件箱.duowei");
  assert.equal(inbox.messages[2].attachments[0].mimeType,"image/png");
  assert.match(inbox.messages[2].attachments[0].path,/^WeChat2Ob\/附件\/.+photo\.png$/);
  assert.equal(inbox.tablePath,"WeChat2Ob/微信收件箱.duowei");
  assert.equal(inbox.inboxRoot,"WeChat2Ob");
  assert.match(inbox.todayNotePath,/^日记\/\d{4}-\d\d-\d\d\.md$/);
  assert.ok(!("time" in inbox.messages[0]),"internal sort key is not exposed");

  assert.deepEqual((await index.query(s,{days:0,limit:2},now)).messages.map(m=>m.content),["最新文字",""],"limit after sort");
  assert.deepEqual((await index.query(s,{days:0,kinds:["voice"]},now)).messages.map(m=>m.kind),["voice"]);
  assert.equal((await index.query(s,{days:0},now)).messages.length,4,"days 0 means no limit");
});

test("pending is null without table output and journals are cached until invalidated",async()=>{
  const s:Settings={...DEFAULT_SETTINGS};
  const {vault,index}=await synced(s,[message()]);
  const first=await index.query(s);
  assert.equal(first.pending,null);
  assert.equal(first.tablePath,"");
  const reads=vault.reads;
  await index.query(s);
  assert.equal(vault.reads,reads,"second query served from cache");
  index.invalidate();
  await index.query(s);
  assert.ok(vault.reads>reads,"invalidate re-reads journals");
});

test("corrupt or foreign files in state are skipped",async()=>{
  const s:Settings={...DEFAULT_SETTINGS};
  const {vault,index}=await synced(s,[message()]);
  const stream=[...vault.folders].find(p=>/\/[a-f\d]{64}$/.test(p))!;
  await vault.write(`${stream}/${"0".repeat(64)}.json`,"{not json");
  await vault.write(`${stream}/notes.json`,JSON.stringify({format:1}));
  assert.equal((await index.query(s)).messages.length,1);
  assert.deepEqual((await new InboxIndex(new MemoryVault(),state).query(s)).messages,[],"missing state folder");
});

test("setProcessed flips only this plugin's rows between 待整理 and 已整理, keeping hand-set statuses",async()=>{
  const s:Settings={...DEFAULT_SETTINGS,duowei:true};
  const [a,b,c]=[message(),message(),message()];
  const {vault,index}=await synced(s,[a,b,c]);
  const keyOf=(m:Message)=>hash("http://127.0.0.1:7342\n"+m.id);
  const path=duoweiPath(s);
  const table=()=>JSON.parse(vault.files.get(path) as string);
  const status=(m:Message)=>table().records.find((r:any)=>r.id===`rec_w2o_${keyOf(m)}`).values.fld_w2o_status;
  assert.equal((await index.query(s)).pending,3);

  // A hand-set status on c must survive.
  const doc=table();doc.records.find((r:any)=>r.id===`rec_w2o_${keyOf(c)}`).values.fld_w2o_status="重要";
  vault.files.set(path,JSON.stringify(doc));

  const done=setProcessedInTable(vault.files.get(path) as string,[keyOf(a),keyOf(c)],true,s);
  assert.equal(done.changed,1);
  assert.equal(done.skipped,1,"hand-set status is skipped");
  vault.files.set(path,done.text);
  assert.deepEqual([status(a),status(b),status(c)],["已整理","待整理","重要"]);
  assert.equal((await index.query(s)).pending,1,"pending count follows");

  const again=setProcessedInTable(done.text,[keyOf(a)],true,s);
  assert.equal(again.changed,0,"idempotent");
  assert.equal(again.text,done.text,"no rewrite when nothing changes");

  const back=setProcessedInTable(done.text,[keyOf(a)],false,s);
  assert.equal(back.changed,1);
  vault.files.set(path,back.text);
  assert.equal(status(a),"待整理");
  assert.ok(JSON.parse(back.text).meta.revision>JSON.parse(done.text).meta.revision,"table revision bumps");
});

test("mapped select tables are only updated when a 已整理 option already exists",()=>{
  const doc=newDuowei();
  const statusField=doc.fields.find((f:any)=>f.id==="fld_w2o_status");
  statusField.type="singleSelect";
  statusField.options=[{id:"opt_pending",name:"待整理"}];
  doc.records.push({id:"rec_w2o_"+"a".repeat(64),values:{fld_w2o_content:"x",fld_w2o_status:"opt_pending"},createdAt:"",updatedAt:"",revision:0});
  const s:Settings={...DEFAULT_SETTINGS,duowei:true,duoweiMode:"mapped",duoweiPath:"t.duowei",duoweiTableId:doc.id,duoweiFieldMap:{content:"fld_w2o_content",status:"fld_w2o_status"}};
  const missing=setProcessedInTable(JSON.stringify(doc),["a".repeat(64)],true,s);
  assert.equal(missing.changed,0,"no 已整理 option: nothing changes, no option is added");
  assert.equal(JSON.parse(missing.text).fields.find((f:any)=>f.id==="fld_w2o_status").options.length,1);
  statusField.options.push({id:"opt_done",name:"已整理"});
  const ok=setProcessedInTable(JSON.stringify(doc),["a".repeat(64)],true,s);
  assert.equal(ok.changed,1);
  assert.equal(JSON.parse(ok.text).records[0].values.fld_w2o_status,"opt_done","stores the option id");
});
