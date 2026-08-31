// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {SyncEngine} from "../src/engine";
import {DEFAULT_SETTINGS,hash,tokenSecretId,messageKey,settingsFrom,normalizeEndpoint,validateSettings,vaultPath,type InboxClient,type Message,type VaultPort,type Settings} from "../src/model";
import {parseConnection} from "../src/connection";
import {appendDuowei,newDuowei} from "../src/outputs";
import {duoweiPath,fieldMappingIssue,inspectDuowei,validateDuowei,suggestFieldMap} from "../src/duowei";
import {SECTION_START,SECTION_END,messageMarker,notePath,noteReceipt,literal} from "../src/notes";
import {cleanLegacyText} from "../src/cleanup";
import {baseText,indexBaseText} from "../src/bases";

class MemoryVault implements VaultPort {
  files=new Map<string,string|ArrayBuffer>();
  folders=new Set<string>();
  writes=0;
  failTable=false;
  failCheckpointAfterNote=false;
  async exists(p:string){return this.files.has(p)||this.folders.has(p);}
  async read(p:string){const text=this.files.get(p);if(typeof text!=="string")throw new Error("not text: "+p);return text;}
  async readBinary(p:string){const b=this.files.get(p);if(!(b instanceof ArrayBuffer))throw new Error("not binary");return b;}
  async create(p:string,text:string){if(this.files.has(p))throw new Error("exists");this.writes++;this.files.set(p,text);}
  async write(p:string,text:string){if(this.failCheckpointAfterNote && text.includes('"notes:') && p.endsWith('.json')){this.failCheckpointAfterNote=false;throw new Error("crash at checkpoint");}this.writes++;this.files.set(p,text);}
  async process(p:string,fn:(t:string)=>string){if(this.failTable&&p.endsWith('.duowei'))throw new Error("disk full");this.writes++;this.files.set(p,fn(await this.read(p)));}
  async createBinary(p:string,b:ArrayBuffer){this.writes++;this.files.set(p,b);}
  async mkdir(p:string){const parts=p.split('/');for(let i=1;i<=parts.length;i++)this.folders.add(parts.slice(0,i).join('/'));}
  async list(p:string){const immediate=(v:string)=>v.startsWith(p+'/')&&!v.slice(p.length+1).includes('/');return {files:[...this.files.keys()].filter(immediate),folders:[...this.folders].filter(immediate)};}
}
class FakeClient implements InboxClient {
  endpoint="http://127.0.0.1:7342";
  pending:Message[]=[];
  acks:string[]=[];
  consumers:string[]=[];
  failAck=false;
  calls=0;
  binary=new TextEncoder().encode('attachment contents').buffer;
  async test(){return {ok:true,serviceVersion:"0.1.0",accountConfigured:true,messageCount:this.pending.length};}
  async listMessages(id:string){this.calls++;this.consumers.push(id);await Promise.resolve();return this.pending.slice();}
  async acknowledge(id:string,ids:string[]){if(this.failAck)throw new Error("ack network failed");this.consumers.push(id);this.acks.push(...ids);this.pending=this.pending.filter(m=>!ids.includes(m.id));return ids.length;}
  async downloadAttachment(){return this.binary;}
}
function message(overrides:Partial<Message>={}):Message{return {id:randomUUID(),sourceMessageId:randomUUID(),seq:"1",senderId:"user",recipientId:"bot",sessionId:"chat",kind:"text",title:"中文标题",content:"测试内容",transcript:"",receivedAt:"2026-08-31T02:00:00.000Z",attachments:[],...overrides};}
const full:Settings={...DEFAULT_SETTINGS,duowei:true};
const state='.obsidian/plugins/wechat2ob/state';
const setup=()=>{const vault=new MemoryVault(),client=new FakeClient();return {vault,client,engine:new SyncEngine(vault,state,"wechat2ob-isolated-consumer")};};
const notes=(v:MemoryVault)=>[...v.files.keys()].filter(p=>p.endsWith('.md')&&!p.startsWith('.obsidian/'));

test("SecretStorage key accepts a complete consumer UUID without exceeding Obsidian's limit",()=>{
  const clientId='wechat2ob-'+randomUUID();
  assert.ok(('wechat2ob-api-token-'+clientId).length>64,'fixture must reproduce the released bug');
  const key=tokenSecretId(clientId);
  const secrets=new Map<string,string>();
  const setSecret=(id:string,value:string)=>{assert.match(id,/^[a-z0-9-]{1,64}$/);secrets.set(id,value);};
  setSecret(key,'synthetic-token');
  assert.equal(secrets.get(tokenSecretId(clientId)),'synthetic-token');
  setSecret(key,'');assert.equal(secrets.get(key),'');
  assert.notEqual(tokenSecretId('wechat2ob-'+randomUUID()),key,'other clients must use separate keys');
});

test("all three outputs complete before ACK, Bases indexes diary files",async()=>{
  const {vault,client,engine}=setup();client.pending=[message()];
  const r=await engine.sync(client,full);assert.equal(r.completed,1);assert.equal(client.acks.length,1);assert.equal(notes(vault).length,1);
  const base=JSON.parse((await vault.read('WeChat2Ob/微信笔记.base')).split('\n').slice(1).join('\n'));
  assert.deepEqual(base.filters.and[1],{or:['file.path == "日记/2026-08-31.md"']});
  assert.ok(base.views[0].order.includes('file.name'));
  assert.equal(await vault.read(notes(vault)[0]),'测试内容\n');
  const doc=JSON.parse(await vault.read('WeChat2Ob/微信收件箱.duowei'));assert.equal(doc.records.length,1);
  for(const key of Object.keys(doc.records[0].values))assert.ok(doc.fields.some((f:any)=>f.id===key));
  assert.ok(client.consumers.every(id=>id==="wechat2ob-isolated-consumer"));
});
test("failed ACK and process restart preserve user edits, no duplicate records",async()=>{
  const {vault,client,engine}=setup();client.pending=[message()];client.failAck=true;
  assert.equal((await engine.sync(client,full)).failed,1);assert.equal(client.acks.length,0);
  const note=notes(vault)[0];const edited=(await vault.read(note))+"用户新增整理\n";vault.files.set(note,edited);
  client.failAck=false;await new SyncEngine(vault,state,"wechat2ob-isolated-consumer").sync(client,full);
  assert.equal(await vault.read(note),edited);assert.equal(notes(vault).length,1);
  assert.equal(JSON.parse(await vault.read('WeChat2Ob/微信收件箱.duowei')).records.length,1);
});
test("partial output failure never ACKs and a retry completes only missing sinks",async()=>{
  const {vault,client,engine}=setup();client.pending=[message()];vault.failTable=true;
  assert.equal((await engine.sync(client,full)).failed,1);assert.equal(notes(vault).length,1);assert.equal(client.acks.length,0);
  vault.failTable=false;assert.equal((await engine.sync(client,full)).completed,1);assert.equal(notes(vault).length,1);
});
test("crash after writing note but before checkpoint does not overwrite edited note",async()=>{
  const {vault,client,engine}=setup();client.pending=[message()];vault.failCheckpointAfterNote=true;
  assert.equal((await engine.sync(client,full)).failed,1);
  const p=notes(vault)[0],text=await vault.read(p)+"手动内容";vault.files.set(p,text);
  await engine.sync(client,full);assert.equal(await vault.read(p),text);assert.equal(client.acks.length,1);
});
test("adding outputs replays local history without reading or ACKing the service",async()=>{
  const {vault,client,engine}=setup();client.pending=[message()];await engine.sync(client,{...DEFAULT_SETTINGS,bases:false});
  const calls=client.calls,acks=client.acks.length;await engine.replay(client,full);
  assert.equal(client.calls,calls);assert.equal(client.acks.length,acks);assert.equal(notes(vault).length,1);
  assert.equal(JSON.parse(await vault.read('WeChat2Ob/微信收件箱.duowei')).records.length,1);
});
test("Base-only creates notes; .duowei-only has no Markdown dependency",async()=>{
  for(const mode of ['base','duowei']){const {vault,client,engine}=setup();client.pending=[message()];await engine.sync(client,{...DEFAULT_SETTINGS,notes:false,bases:mode==='base',duowei:mode==='duowei'});assert.equal(notes(vault).length,mode==='base'?1:0);}
});
test("attachment checksum mismatch prevents ACK; valid retry reuses stable file path",async()=>{
  const {vault,client,engine}=setup();const bytes=client.binary;
  client.pending=[message({kind:'file',attachments:[{id:randomUUID(),kind:'file',filename:'../../a[bad].txt',mimeType:'text/plain',byteSize:bytes.byteLength,sha256:hash(new Uint8Array(bytes))}]})];
  client.binary=new TextEncoder().encode('wrong').buffer;assert.equal((await engine.sync(client,full)).failed,1);assert.equal(client.acks.length,0);
  client.binary=bytes;await engine.sync(client,full);assert.equal(client.acks.length,1);
  const files=[...vault.files.keys()].filter(p=>p.includes('/附件/'));assert.equal(files.length,1);assert.ok(!files[0].includes('..'));assert.ok(!files[0].includes('['));
});
test("same upstream source ID in different service records is never incorrectly deduplicated",async()=>{
  const {vault,client,engine}=setup();client.pending=[message({sourceMessageId:'same'}),message({sourceMessageId:'same'})];await engine.sync(client,full);assert.equal(notes(vault).length,1);assert.equal(await vault.read(notes(vault)[0]),'测试内容\n\n测试内容\n');assert.equal(JSON.parse(await vault.read('WeChat2Ob/微信收件箱.duowei')).records.length,2);
});
test("empty polling has no vault writes and overlapping calls share one operation",async()=>{
  const {vault,client,engine}=setup();const a=engine.sync(client,full),b=engine.sync(client,full);assert.equal(a,b);await a;assert.equal(vault.writes,0);assert.equal(client.calls,1);
});
test("unload during download prevents writes and acknowledgement",async()=>{
  const {vault,client,engine}=setup();const binary=client.binary;client.pending=[message({attachments:[{id:randomUUID(),kind:'file',filename:'a.txt',mimeType:'text/plain',byteSize:binary.byteLength,sha256:hash(new Uint8Array(binary))}]})];
  client.downloadAttachment=async()=>{engine.stop();return binary;};await assert.rejects(engine.sync(client,full),/停止/);assert.equal(client.acks.length,0);assert.equal(notes(vault).length,0);
});
test("foreign directory, foreign note, modified schema and remote auto-pairing are rejected",async()=>{
  const {vault,client,engine}=setup();await vault.mkdir('WeChat2Ob');await vault.create('WeChat2Ob/已有笔记.md','keep');client.pending=[message()];await assert.rejects(engine.sync(client,full),/已有其他数据/);assert.equal(await vault.read('WeChat2Ob/已有笔记.md'),'keep');
  assert.throws(()=>appendDuowei('{"records":[]}',{} as any,null),/不是/);
  for(const p of ['../old','.obsidian','a/../old','D:/old','a\\old','/root','AUX','a/..'])assert.throws(()=>vaultPath(p));
  for(const url of ['http://example.com','https://u:p@example.com','https://example.com/?token=secret'])assert.throws(()=>normalizeEndpoint(url));
  assert.throws(()=>validateSettings({...full,notes:false,bases:false,duowei:false}));
  for(const endpoint of ['https://example.com','http://127.0.0.1/?x=1','http://u:p@127.0.0.1'])assert.throws(()=>parseConnection(JSON.stringify({format:1,product:'wechat2ob-inbox',endpoint,apiToken:'x'})));
  assert.throws(()=>parseConnection(JSON.stringify({format:1,product:'duowei-weixin-inbox',endpoint:'http://127.0.0.1:7341',apiToken:'old'})),/不是 WeChat2Ob/);
});
test("message text cannot create executable code blocks or plugin markers",async()=>{
  const {vault,client,engine}=setup();client.pending=[message({title:'x\n---\nevil: yes',content:'```dataviewjs\nalert(1)\n```\n![[secret]]\n<script>x</script>\n'+SECTION_END})];await engine.sync(client,DEFAULT_SETTINGS);const t=await vault.read(notes(vault)[0]);assert.ok(!t.includes('```'));assert.ok(!t.includes('<script>'));assert.ok(t.includes('\\`\\`\\`dataviewjs'));assert.ok(!t.includes(SECTION_END));assert.ok(!t.startsWith('>'));
});

test("same-day messages append to one existing diary and preserve its frontmatter and personal sections",async()=>{
  const {vault,client,engine}=setup();
  const s={...full,noteTimeZone:'Asia/Shanghai'};
  const original='---\r\n自定义: "保留"\r\ntags: [life]\r\n---\r\n# 今天的日记\r\n\r\n原有正文\r\n';
  await vault.mkdir('日记');await vault.create('日记/2026-08-31.md',original);
  const first=message({content:'第一条',receivedAt:'2026-08-31T01:00:00Z'});
  client.pending=[first];await engine.sync(client,s);
  const before=await vault.read('日记/2026-08-31.md');
  vault.files.set('日记/2026-08-31.md',before+'\r\n## 晚间复盘\r\n手写内容\r\n');
  client.pending=[message({content:'第二条',receivedAt:'2026-08-31T03:00:00Z'})];await engine.sync(client,s);
  const after=await vault.read('日记/2026-08-31.md');assert.ok(after.startsWith(before+'\r\n## 晚间复盘\r\n手写内容\r\n'));assert.ok(after.endsWith('\r\n\r\n第二条\r\n'));assert.equal(notes(vault).length,1);
  assert.ok(!after.includes('wechat2ob'));assert.ok(after.indexOf('第二条')>after.indexOf('手写内容'));
});
test("journal date follows message time and timezone, including midnight and delayed delivery",async()=>{
  const {vault,client,engine}=setup();const s={...DEFAULT_SETTINGS,noteTimeZone:'Asia/Shanghai'};
  client.pending=[message({receivedAt:'2026-08-31T15:59:59Z'}),message({receivedAt:'2026-08-31T16:00:00Z'}),message({receivedAt:'2026-08-30T03:00:00Z'})];await engine.sync(client,s);
  assert.deepEqual(notes(vault).sort(),['日记/2026-08-30.md','日记/2026-08-31.md','日记/2026-09-01.md']);
  assert.equal(notePath({...s,noteTimeZone:'UTC'},'2026-08-31T16:00:00Z'),'日记/2026-08-31.md');
});
test("fixed-file mode appends different dates to a chosen existing file outside the managed root",async()=>{
  const {vault,client,engine}=setup();const s:Settings={...full,noteMode:'file',fixedNotePath:'我的笔记/收件.md'};
  await vault.mkdir('我的笔记');await vault.create(s.fixedNotePath,'---\nstatus: keep\n---\n# 个人收件\n保留正文');
  client.pending=[message(),message({receivedAt:'2026-09-02T01:00:00Z'})];await engine.sync(client,s);
  assert.deepEqual(notes(vault),[s.fixedNotePath]);assert.ok((await vault.read(s.fixedNotePath)).startsWith('---\nstatus: keep\n---\n# 个人收件\n保留正文'));
  const doc=JSON.parse(await vault.read('WeChat2Ob/微信收件箱.duowei'));
  assert.ok(doc.records.every((r:any)=>r.values.fld_w2o_note==='[[我的笔记/收件.md]]'));
});
test("fixed file at vault root is created and retries never append a duplicate message",async()=>{
  const {vault,client,engine}=setup();const s:Settings={...DEFAULT_SETTINGS,noteMode:'file',fixedNotePath:'微信.md'};
  client.pending=[message()];client.failAck=true;await engine.sync(client,s);const first=await vault.read('微信.md');client.failAck=false;await engine.sync(client,s);assert.equal(await vault.read('微信.md'),first);assert.deepEqual(notes(vault),['微信.md']);
});
test("plain append preserves unrelated old fragments and does not depend on a managed region",async()=>{
  const {vault,client,engine}=setup();const s:Settings={...DEFAULT_SETTINGS,noteMode:'file',fixedNotePath:'我的笔记.md'};
  const original='# 日记\n'+SECTION_START+'\n用户编辑中\n';await vault.create(s.fixedNotePath,original);client.pending=[message()];assert.equal((await engine.sync(client,s)).failed,0);assert.equal(await vault.read(s.fixedNotePath),original+'\n测试内容\n');assert.equal(client.acks.length,1);
});
test("legacy scattered notes remain untouched when local history is replayed to a diary",async()=>{
  const {vault,client,engine}=setup();const m=message(),key=messageKey(client.endpoint,m),folder=state+'/'+hash(client.endpoint);
  const legacy='WeChat2Ob/笔记/旧笔记.md';await vault.mkdir('WeChat2Ob');await vault.create('WeChat2Ob/.wechat2ob-root.json',JSON.stringify({product:'wechat2ob',format:1}));await vault.mkdir('WeChat2Ob/笔记');await vault.create(legacy,'旧笔记与人工整理');await vault.mkdir(folder);
  await vault.create(`${folder}/${key}.json`,JSON.stringify({format:1,key,message:m,attachments:[],receipts:{'notes:WeChat2Ob':{path:legacy,at:m.receivedAt}},received:m.receivedAt}));
  const r=await engine.replay(client,DEFAULT_SETTINGS);assert.equal(r.failed,0);assert.equal(await vault.read(legacy),'旧笔记与人工整理');assert.ok(await vault.exists(notePath(DEFAULT_SETTINGS,m.receivedAt)));
  const after=await vault.read(notePath(DEFAULT_SETTINGS,m.receivedAt));await engine.replay(client,DEFAULT_SETTINGS);assert.equal(await vault.read(notePath(DEFAULT_SETTINGS,m.receivedAt)),after);assert.equal(client.calls,0);assert.equal(client.acks.length,0);
});
test("old configuration gains diary defaults and note paths cannot target config or other file types",()=>{
  const migrated=settingsFrom({root:'WeChat2Ob',notes:true});assert.equal(migrated.noteMode,'daily');assert.equal(migrated.dailyFolder,'日记');
  for(const p of ['.obsidian/settings.md','../outside.md','旧表.duowei','/absolute.md','C:/file.md'])assert.throws(()=>validateSettings({...full,fixedNotePath:p}));
  assert.throws(()=>validateSettings({...full,noteTimeZone:'invalid/zone'}));assert.equal(notePath({...full,dailyFolder:'',noteTimeZone:'UTC'},'2026-08-31T01:00:00Z'),'2026-08-31.md');
});
test("customized Base and old per-message Base are never rewritten",async()=>{
  const {vault,client,engine}=setup();await vault.mkdir('WeChat2Ob');await vault.create('WeChat2Ob/.wechat2ob-root.json',JSON.stringify({product:'wechat2ob',format:1}));await vault.create('WeChat2Ob/微信笔记.base','用户自定义视图');await vault.create('WeChat2Ob/微信收件箱.base','旧版视图');client.pending=[message()];await engine.sync(client,full);assert.equal(await vault.read('WeChat2Ob/微信笔记.base'),'用户自定义视图');assert.equal(await vault.read('WeChat2Ob/微信收件箱.base'),'旧版视图');
});

test("write intent failure leaves the note untouched and a retry appends once",async()=>{
  const {vault,client,engine}=setup();client.pending=[message()];
  const write=vault.write.bind(vault);let fail=true;
  vault.write=async(p,text)=>{if(fail&&text.includes('"noteWrites"')){fail=false;throw new Error('intent disk failure');}await write(p,text);};
  assert.equal((await engine.sync(client,full)).failed,1);assert.equal(notes(vault).length,0);assert.equal(client.acks.length,0);
  assert.equal((await engine.sync(client,full)).completed,1);assert.equal(await vault.read(notes(vault)[0]),'测试内容\n');
});

test("ambiguous user edit after a crash pauses without duplicating or overwriting content",async()=>{
  const {vault,client,engine}=setup();client.pending=[message()];vault.failCheckpointAfterNote=true;
  assert.equal((await engine.sync(client,full)).failed,1);
  const p=notes(vault)[0],changed='用户修改了原消息\n';vault.files.set(p,changed);
  const result=await new SyncEngine(vault,state,'wechat2ob-isolated-consumer').sync(client,full);
  assert.equal(result.failed,1);assert.match(result.errors[0],/需要核对/);assert.equal(client.acks.length,0);assert.equal(await vault.read(p),changed);
});

test("an edit between the saved intent and atomic append is preserved on re-plan",async()=>{
  const {vault,client,engine}=setup();await vault.mkdir('日记');await vault.create('日记/2026-08-31.md','原文\n');
  const process=vault.process.bind(vault);let edit=true;
  vault.process=async(p,fn)=>{if(p==='日记/2026-08-31.md'&&edit){edit=false;vault.files.set(p,'原文\n用户刚补充\n');}await process(p,fn);};
  client.pending=[message()];assert.equal((await engine.sync(client,full)).completed,1);
  assert.equal(await vault.read('日记/2026-08-31.md'),'原文\n用户刚补充\n\n测试内容\n');
});

function legacyText(journals:any[],prefix='# 2026-08-31\n\n',suffix='') {
  return prefix+SECTION_START+'\n## 微信收件\n\n#wechat2ob/inbox\n\n'+journals.map(j=>messageMarker(j.key)+'\n### 2026-08-31 10:00:00 · 文字\n\n发送者：'+literal(j.message.senderId)+'\n\n'+j.message.content.split('\n').map((line:string)=>'> '+literal(line)).join('\n')+'\n\n^wechat2ob-'+j.key+'\n\n').join('')+SECTION_END+'\n'+suffix;
}

test("legacy cleanup backs up originals, keeps edits and receipts, and repairs table/Base links",async()=>{
  const {vault,client,engine}=setup();const messages=[message({content:'第一条'}),message({content:'第二条'})];client.pending=messages;
  await engine.sync(client,full);
  const journals=await Promise.all(messages.map(m=>vault.read(state+'/'+hash(client.endpoint)+'/'+messageKey(client.endpoint,m)+'.json').then(JSON.parse)));
  const path='日记/2026-08-31.md';const original=legacyText(journals).replace('> 第一条','> 人工编辑后的第一条');vault.files.set(path,original);
  const table=JSON.parse(await vault.read('WeChat2Ob/微信收件箱.duowei'));table.extra={keep:true};
  for(const row of table.records)row.values.fld_w2o_note=`[[${path}#^wechat2ob-${row.values.fld_w2o_message}]]`;
  vault.files.set('WeChat2Ob/微信收件箱.duowei',JSON.stringify(table));
  const base=JSON.parse(baseText().split('\n').slice(1).join('\n'));base.filters.and[1]='file.hasTag("wechat2ob/inbox")';base.filters.and.push('file.size > 0');base.views[0].name='我的视图';
  vault.files.set('WeChat2Ob/微信笔记.base','# wechat2ob-base-v2\n'+JSON.stringify(base));
  const calls=client.calls,acks=client.acks.length;
  const result=await engine.cleanup(client,full);assert.equal(result.failed,0);assert.equal(result.completed,1);assert.ok(result.backupRoot);
  assert.equal(await vault.read(path),'人工编辑后的第一条\n\n第二条\n');assert.equal(client.calls,calls);assert.equal(client.acks.length,acks);
  const backups=JSON.parse(await vault.read(result.backupRoot+'/index.json')).files;
  assert.equal(await vault.read(backups.find((f:any)=>f.source===path).backup),original);assert.equal(backups.length,3);
  const newTable=JSON.parse(await vault.read('WeChat2Ob/微信收件箱.duowei'));assert.deepEqual(newTable.extra,{keep:true});assert.ok(newTable.records.every((r:any)=>r.values.fld_w2o_note===`[[${path}]]`));
  const newBase=JSON.parse((await vault.read('WeChat2Ob/微信笔记.base')).split('\n').slice(1).join('\n'));assert.equal(newBase.views[0].name,'我的视图');assert.ok(newBase.filters.and.includes('file.size > 0'));assert.deepEqual(newBase.filters.and[1],{or:[`file.path == "${path}"`]});
  const clean=await vault.read(path);await engine.replay(client,full);assert.equal(await vault.read(path),clean);
  assert.equal((await engine.cleanup(client,full)).completed,0);
  client.pending=[message({content:'第三条'})];await engine.sync(client,full);assert.equal(await vault.read(path),clean+'\n第三条\n');
});

test("legacy cleanup preserves custom frontmatter, headings, suffixes, CRLF and message edits",()=>{
  const m=message({content:'用户保留正文'}),j={key:hash('fixture'),message:m,attachments:[],receipts:{}} as any;
  const prefix='---\ncustom: keep\n---\n# 我的标题\n\n个人正文\n\n',suffix='\n## 个人复盘\n末尾内容\n';
  const original=legacyText([j],prefix,suffix).replace(/\n/g,'\r\n');
  const cleaned=cleanLegacyText(original,'日记/2026-08-31.md',[j]);
  assert.ok(cleaned.text.startsWith(prefix.replace(/\n/g,'\r\n')));assert.ok(cleaned.text.endsWith(suffix.replace(/\n/g,'\r\n')));assert.ok(cleaned.text.includes('用户保留正文\r\n'));assert.ok(!cleaned.text.includes('wechat2ob'));
});

test("incomplete or unknown legacy boundaries are not destructively cleaned",()=>{
  const j={key:hash('fixture'),message:message(),attachments:[],receipts:{}} as any;
  const valid=legacyText([j]);
  assert.throws(()=>cleanLegacyText(valid,'x.md',[]),/缺失日志/);
  assert.throws(()=>cleanLegacyText(valid.replace('^wechat2ob-'+j.key,''),'x.md',[j]),/边界不完整/);
  assert.throws(()=>cleanLegacyText(valid.replace(SECTION_END,''),'x.md',[j]),/不完整/);
});

test("Base path scope keeps all received days without requiring note tags",()=>{
  const {vault}=setup();const first=indexBaseText(baseText(),['日记/2026-08-31.md'],vault);
  const second=indexBaseText(first,['日记/2026-09-01.md','收件箱/指定.md'],vault);
  const doc=JSON.parse(second.split('\n').slice(1).join('\n'));
  assert.equal(doc.filters.and[1].or.length,3);assert.ok(!second.includes('file.hasTag'));
  assert.equal(indexBaseText(second,['日记/2026-08-31.md'],vault),second);
});

test("cleanup transfers old crash markers into private receipts before removing them",async()=>{
  const {vault,client,engine}=setup();const m=message();client.pending=[m];await engine.sync(client,full);
  const path=notePath(full,m.receivedAt),file=state+'/'+hash(client.endpoint)+'/'+messageKey(client.endpoint,m)+'.json';
  const j=JSON.parse(await vault.read(file));j.receipts={};vault.files.set(file,JSON.stringify(j));vault.files.set(path,legacyText([j]));
  assert.equal((await engine.cleanup(client,full)).failed,0);
  assert.ok(JSON.parse(await vault.read(file)).receipts[noteReceipt(path)]);
  client.pending=[m];await engine.sync(client,full);assert.equal(await vault.read(path),'测试内容\n');
});

test("legacy voice cleanup retains transcription and playable attachments",()=>{
  const j={key:hash('voice'),message:message({content:'',transcript:'语音转写内容'}),attachments:[{path:'WeChat2Ob/附件/test.wav'}],receipts:{}} as any;
  const text=legacyText([j]).replace('> \n','> （此消息没有文字正文）\n\n**语音转写**\n\n> 语音转写内容\n\n![[WeChat2Ob/附件/test.wav]]\n');
  assert.equal(cleanLegacyText(text,'日记/2026-08-31.md',[j]).text,'语音转写内容\n\n![[WeChat2Ob/附件/test.wav]]\n');
});

test("exclusive-create races preserve others' text and uncertain create failures do not duplicate",async()=>{
  for(const race of [true,false]) {
    const {vault,client,engine}=setup();const create=vault.create.bind(vault);let once=true;
    vault.create=async(p,text)=>{
      if(p.endsWith('.md')&&once){once=false;if(race){vault.files.set(p,'并发创建的笔记\n');throw new Error('File already exists');}await create(p,text);throw new Error('create event failed after writing');}
      await create(p,text);
    };
    client.pending=[message()];const result=await engine.sync(client,full);
    assert.equal(result.failed,race?0:1);
    if(!race){assert.equal(client.acks.length,0);await engine.sync(client,full);}
    assert.equal(await vault.read(notes(vault)[0]),race?'并发创建的笔记\n\n测试内容\n':'测试内容\n');assert.equal(client.acks.length,1);
  }
});

function ordinaryTable() {
  return {schemaVersion:1,id:'tbl_personal',name:'自己的表格',titleFieldId:'custom_title',
    fields:[{id:'custom_title',name:'名称',type:'text'},{id:'custom_body',name:'内容',type:'longText',markdown:false},{id:'custom_media',name:'附件',type:'attachment'},{id:'custom_date',name:'接收时间',type:'dateTime'},{id:'custom_done',name:'完成',type:'checkbox'}],
    records:[{id:'rec_personal',values:{custom_title:'原有记录',custom_body:'人工编辑',custom_done:true},customProperty:'保留'}],
    views:[{id:'custom_view',name:'自定义视图',type:'grid',fieldOrder:['custom_title','custom_body'],hiddenFields:['custom_done'],filters:[{fieldId:'custom_done',operator:'is',value:true}]}],activeViewId:'custom_view',meta:{writerVersion:9,revision:8},customProperty:{keep:true}};
}
function mappedSettings(doc=ordinaryTable()):Settings{return {...DEFAULT_SETTINGS,notes:false,bases:false,duowei:true,duoweiMode:'mapped',duoweiPath:'我的表格/消息.duowei',duoweiTableId:doc.id,duoweiFieldMap:suggestFieldMap(doc)};}

function selectTable(multi=false) {
  const doc=ordinaryTable();
  return {...doc,fields:[...doc.fields,
    {id:'message_type',name:'类型',type:multi?'multiSelect':'singleSelect',options:[{id:'opt_text',name:'文字',color:'blue'},{id:'opt_image',name:'图片',color:'pink'}]},
    {id:'message_status',name:'状态',type:multi?'multiSelect':'singleSelect',options:[{id:'opt_pending',name:'待整理',color:'orange'},{id:'opt_done',name:'已整理',color:'green'}]},
    {id:'message_key',name:'微信消息 ID',type:'text'},
    {id:'computed',name:'计算结果',type:'formula',formula:'1 + 1'}]};
}

test('field refresh matches actual Weixin names and preserves manual choices including explicit skips',()=>{
  const doc=selectTable(),suggested=suggestFieldMap(doc);
  assert.equal(suggested.type,'message_type');assert.equal(suggested.status,'message_status');assert.equal(suggested.message,'message_key');
  const current={content:'custom_body',type:'custom_title',status:'',message:'message_key'},after=suggestFieldMap(doc,current);
  for(const [key,value] of Object.entries(current))assert.equal(after[key],value);
  assert.equal(after.title,undefined,'do not reuse a column already assigned manually');assert.equal(after.attachments,'custom_media');
  assert.equal(suggestFieldMap(doc,{status:'removed_field'}).status,'removed_field','keep invalid choices visible for user correction');
});

test('mapping candidates use actual target types and explain incompatible or already mapped fields',()=>{
  const doc=selectTable(),map=suggestFieldMap(doc),field=(id:string)=>doc.fields.find(f=>f.id===id)!;
  assert.equal(fieldMappingIssue(field('message_status'),'status',map),'');
  assert.equal(fieldMappingIssue(field('message_type'),'type',map),'');
  assert.match(fieldMappingIssue(field('custom_title'),'status',map),/已用于标题/);
  assert.equal(fieldMappingIssue(field('computed'),'status',map),'类型不兼容');
  assert.equal(fieldMappingIssue(field('message_status'),'content',map),'类型不兼容');
  assert.equal(fieldMappingIssue(field('custom_title'),'status',{...map,title:''}),'');
});

test('single select mappings write existing option IDs and preserve options and old rows across retries',async()=>{
  const {vault,client,engine}=setup(),doc=selectTable(),s=mappedSettings(doc);await vault.mkdir('我的表格');await vault.create(s.duoweiPath,JSON.stringify(doc));
  client.pending=[message()];client.failAck=true;assert.equal((await engine.sync(client,s)).failed,1);
  client.failAck=false;assert.equal((await new SyncEngine(vault,state,'wechat2ob-isolated-consumer').sync(client,s)).completed,1);
  const after=JSON.parse(await vault.read(s.duoweiPath));assert.equal(after.records.length,2);
  assert.equal(after.records[1].values.message_type,'opt_text');assert.equal(after.records[1].values.message_status,'opt_pending');
  assert.deepEqual(after.fields,doc.fields);assert.deepEqual(after.records[0],doc.records[0]);assert.deepEqual(after.views,doc.views);
});

test('multi select mappings store arrays of existing option IDs instead of labels or scalar values',async()=>{
  const {vault,client,engine}=setup(),doc=selectTable(true),s=mappedSettings(doc);await vault.mkdir('我的表格');await vault.create(s.duoweiPath,JSON.stringify(doc));
  client.pending=[message(),message({kind:'image'})];assert.equal((await engine.sync(client,s)).completed,2);
  const after=JSON.parse(await vault.read(s.duoweiPath));
  assert.deepEqual(after.records[1].values.message_type,['opt_text']);assert.deepEqual(after.records[2].values.message_type,['opt_image']);
  assert.deepEqual(after.records[1].values.message_status,['opt_pending']);assert.deepEqual(after.fields,doc.fields);
});

test('missing select options do not corrupt a row or ACK and a corrected option permits one retry',async()=>{
  const {vault,client,engine}=setup(),doc=selectTable(),s=mappedSettings(doc),original=JSON.stringify(doc);
  await vault.mkdir('我的表格');await vault.create(s.duoweiPath,original);client.pending=[message({kind:'voice'})];
  const failed=await engine.sync(client,s);assert.equal(failed.failed,1);assert.match(failed.errors[0],/缺少.*语音/);assert.equal(client.acks.length,0);assert.equal(await vault.read(s.duoweiPath),original);
  const field=doc.fields.find(f=>f.id==='message_type')!;assert.ok('options' in field&&field.options);field.options.push({id:'opt_voice',name:'语音',color:'purple'});
  await vault.write(s.duoweiPath,JSON.stringify(doc));assert.equal((await engine.sync(client,s)).completed,1);
  const after=JSON.parse(await vault.read(s.duoweiPath));assert.equal(after.records.length,2);assert.equal(after.records[1].values.message_type,'opt_voice');assert.deepEqual(after.fields,doc.fields);
  const status=doc.fields.find(f=>f.id==='message_status')!;assert.ok('options' in status&&status.options);status.options.push({id:'opt_ambiguous',name:'待整理',color:'red'});
  assert.throws(()=>validateDuowei(doc,s),/重名.*待整理/);
  status.options[2]={id:'opt_pending',name:'另一个选项',color:'red'};assert.throws(()=>validateDuowei(doc,s),/选项结构/);
});

test('custom table path is independent of attachments and can use an existing folder',async()=>{
  const {vault,client,engine}=setup();await vault.mkdir('我的表格');await vault.create('我的表格/已有笔记.md','保留');
  const s={...full,duoweiPath:'我的表格/微信消息.duowei'};client.pending=[message(),message()];
  assert.equal((await engine.sync(client,s)).completed,2);assert.equal(await vault.exists('WeChat2Ob/微信收件箱.duowei'),false);
  assert.equal(await vault.read('我的表格/已有笔记.md'),'保留');assert.equal(JSON.parse(await vault.read(s.duoweiPath)).records.length,2);
  const next={...s,duoweiPath:'另一个.duowei'};await engine.replay(client,next);await engine.replay(client,next);
  assert.equal(JSON.parse(await vault.read(next.duoweiPath)).records.length,2);assert.equal(JSON.parse(await vault.read(s.duoweiPath)).records.length,2);
});

test('old table receipts suppress recreation when an explicit path selects the same target',async()=>{
  const {vault,client,engine}=setup(),m=message();client.pending=[m];await engine.sync(client,full);
  const file=`${state}/${hash(client.endpoint)}/${messageKey(client.endpoint,m)}.json`,j=JSON.parse(await vault.read(file));
  j.receipts['duowei:WeChat2Ob']={path:'WeChat2Ob/微信收件箱.duowei',at:m.receivedAt};delete j.receipts['duowei:file:WeChat2Ob/微信收件箱.duowei'];await vault.write(file,JSON.stringify(j));
  const table=JSON.parse(await vault.read('WeChat2Ob/微信收件箱.duowei'));table.records=[];await vault.write('WeChat2Ob/微信收件箱.duowei',JSON.stringify(table));
  await engine.replay(client,{...full,duoweiPath:'WeChat2Ob/微信收件箱.duowei'});
  assert.equal(JSON.parse(await vault.read('WeChat2Ob/微信收件箱.duowei')).records.length,0);
});

test('mapped existing table backs up the original and only appends selected fields',async()=>{
  const {vault,client,engine}=setup(),doc=ordinaryTable(),s=mappedSettings(doc),original=JSON.stringify(doc);await vault.mkdir('我的表格');await vault.create(s.duoweiPath,original);client.pending=[message()];
  assert.equal((await engine.sync(client,s)).completed,1);
  const after=JSON.parse(await vault.read(s.duoweiPath));assert.deepEqual(after.fields,doc.fields);assert.deepEqual(after.views,doc.views);assert.deepEqual(after.records[0],doc.records[0]);assert.deepEqual(after.customProperty,doc.customProperty);assert.equal(after.meta.wechat2ob,undefined);assert.equal(after.meta.revision,9);
  assert.equal(after.records[1].values.custom_body,'测试内容');assert.equal(after.records[1].values.custom_title,'中文标题');assert.equal(after.records[1].values.custom_done,undefined);assert.equal(after.records[1].values.fld_w2o_message,undefined);
  const backups=[...vault.files.keys()].filter(p=>p.endsWith('/original.duowei'));assert.equal(backups.length,1);assert.equal(await vault.read(backups[0]),original);assert.equal(notes(vault).length,0);
});

test('mapped table crash before receipt preserves edited rows and other writers additions',async()=>{
  const {vault,client,engine}=setup(),s=mappedSettings();await vault.mkdir('我的表格');await vault.create(s.duoweiPath,JSON.stringify(ordinaryTable()));
  const write=vault.write.bind(vault);let fail=true;vault.write=async(p,t)=>{if(fail&&t.includes('"duowei:file:')){fail=false;throw new Error('checkpoint failed');}await write(p,t);};client.pending=[message()];
  assert.equal((await engine.sync(client,s)).failed,1);assert.equal(client.acks.length,0);
  const edited=JSON.parse(await vault.read(s.duoweiPath));edited.records[1].values.custom_body='用户修改了新增记录';
  const otherRow={id:'rec_other_plugin',values:{custom_body:'另一个插件新增的内容'},externalBindings:[{provider:'another-plugin'}]};
  edited.records.push(otherRow);await vault.write(s.duoweiPath,JSON.stringify(edited));
  assert.equal((await new SyncEngine(vault,state,'wechat2ob-isolated-consumer').sync(client,s)).completed,1);
  const after=JSON.parse(await vault.read(s.duoweiPath));assert.equal(after.records.length,3);assert.equal(after.records[1].values.custom_body,'用户修改了新增记录');assert.deepEqual(after.records[2],otherRow);
});

test('old Weixin fields and external metadata do not block append or change previous data',async()=>{
  const {vault,client,engine}=setup(),m=message(),doc={...ordinaryTable(),externalConnections:[{provider:'another-plugin',id:'connection-1'}]};
  doc.fields.push({id:'old_wx',name:'微信消息 ID',type:'text'});
  const previous={id:'rec_from_old_plugin',values:{custom_body:m.content,old_wx:m.id},externalBindings:[{provider:'another-plugin',remoteId:'remote-1'}]};
  const input={...doc,records:[...doc.records,previous]},s=mappedSettings(doc);s.duoweiFieldMap.message='old_wx';
  const original=JSON.stringify(input);await vault.mkdir('我的表格');await vault.create(s.duoweiPath,original);
  client.pending=[m];client.failAck=true;assert.equal((await engine.sync(client,s)).failed,1);
  client.failAck=false;assert.equal((await new SyncEngine(vault,state,'wechat2ob-isolated-consumer').sync(client,s)).completed,1);
  const after=JSON.parse(await vault.read(s.duoweiPath));assert.equal(after.records.length,3);
  assert.deepEqual(after.records.slice(0,2),input.records);assert.deepEqual(after.fields,input.fields);assert.deepEqual(after.views,input.views);
  assert.deepEqual(after.externalConnections,input.externalConnections);assert.deepEqual(after.customProperty,input.customProperty);
  assert.equal(after.records[2].values.custom_body,m.content);assert.equal(after.records[2].values.old_wx,messageKey(client.endpoint,m));
  const backup=[...vault.files.keys()].find(p=>p.endsWith('/original.duowei'));assert.ok(backup);assert.equal(await vault.read(backup),original);
});

test('mapped table receipts deduplicate only this plugins messages without requiring a message column',async()=>{
  const {vault,client,engine}=setup(),doc=ordinaryTable(),s={...mappedSettings(doc),duoweiFieldMap:{content:'custom_body'}},first=message(),second=message({content:first.content});
  await vault.mkdir('我的表格');await vault.create(s.duoweiPath,JSON.stringify(doc));client.pending=[first,second];
  assert.equal((await engine.sync(client,s)).completed,2);
  const written=JSON.parse(await vault.read(s.duoweiPath));assert.equal(written.records.length,3);
  assert.equal(written.records[1].values.custom_body,written.records[2].values.custom_body);assert.notEqual(written.records[1].id,written.records[2].id);
  written.records.splice(1,1);const otherRow={id:'rec_other_writer',values:{custom_body:first.content}};written.records.push(otherRow);
  const edited=JSON.stringify(written);await vault.write(s.duoweiPath,edited);client.pending=[first,second];
  assert.equal((await new SyncEngine(vault,state,'wechat2ob-isolated-consumer').sync(client,s)).completed,2);
  assert.equal(await vault.read(s.duoweiPath),edited);
});

test('mapped table backup failure prevents all output and ACK for that message',async()=>{
  const {vault,client,engine}=setup(),s={...mappedSettings(),notes:true};const original=JSON.stringify(ordinaryTable());await vault.mkdir('我的表格');await vault.create(s.duoweiPath,original);
  const create=vault.create.bind(vault);vault.create=async(p,t)=>{if(p.endsWith('/original.duowei'))throw new Error('backup disk full');await create(p,t);};client.pending=[message()];
  assert.equal((await engine.sync(client,s)).failed,1);assert.equal(client.acks.length,0);assert.equal(await vault.read(s.duoweiPath),original);assert.equal(notes(vault).length,0);
});

test('wrong field types, duplicate mapping and replacement table IDs are rejected without changing schema',()=>{
  const doc=ordinaryTable(),s=mappedSettings(doc);validateDuowei(inspectDuowei(JSON.stringify(doc)),s);
  for(const map of [{},{content:'custom_done'},{content:'custom_body',title:'custom_body'},{content:'missing'}] as Record<string,string>[])assert.throws(()=>validateDuowei(doc,{...s,duoweiFieldMap:map}));
  assert.throws(()=>validateDuowei({...doc,id:'another-table'},s),/已被替换/);
  assert.throws(()=>validateDuowei(doc,{...s,duoweiMode:'managed'}),/已有表格/);
  assert.equal(doc.fields.length,5);
});

test('readonly indices, unsupported versions and invalid structures are refused',()=>{
  const doc=ordinaryTable();for(const patch of [{source:{type:'vault'}},{readOnly:true},{meta:{writerVersion:9,readOnly:true}},{meta:{writerVersion:10}}])assert.throws(()=>inspectDuowei(JSON.stringify({...doc,...patch})));
  assert.throws(()=>inspectDuowei(JSON.stringify({...doc,fields:[...doc.fields,doc.fields[0]]})),/字段/);
  assert.throws(()=>inspectDuowei(JSON.stringify({...doc,records:[{id:'r',data:{}}]})),/记录/);
});

test('table target settings migrate safely and reject wrong extensions and traversal',()=>{
  const old=settingsFrom({duowei:true});assert.equal(old.duoweiMode,'managed');assert.equal(duoweiPath(old),'WeChat2Ob/微信收件箱.duowei');assert.deepEqual(old.duoweiFieldMap,{});
  for(const path of ['收件.md','../table.duowei','.obsidian/table.duowei','D:/table.duowei'])assert.throws(()=>validateSettings({...full,duoweiPath:path}));
  assert.throws(()=>validateSettings({...full,duoweiMode:'mapped',duoweiPath:'已有.duowei'}),/读取字段/);
  assert.equal(validateSettings({...full,duoweiPath:'根目录.duowei'}).duoweiPath,'根目录.duowei');
});

test('existing foreign target and missing mapped target never get overwritten or silently created',async()=>{
  const {vault,client,engine}=setup(),doc=ordinaryTable(),s=mappedSettings(doc);await vault.mkdir('我的表格');const original=JSON.stringify(doc);await vault.create(s.duoweiPath,original);client.pending=[message()];
  await assert.rejects(engine.sync(client,{...s,duoweiMode:'managed'}),/已有表格/);assert.equal(await vault.read(s.duoweiPath),original);assert.equal(client.acks.length,0);
  await assert.rejects(engine.sync(client,{...s,duoweiPath:'不存在.duowei'}),/不存在/);assert.equal(await vault.exists('不存在.duowei'),false);
});

test('mapping is revalidated inside atomic table append against concurrent schema changes',async()=>{
  const {vault,client,engine}=setup(),s=mappedSettings();await vault.mkdir('我的表格');await vault.create(s.duoweiPath,JSON.stringify(ordinaryTable()));
  const process=vault.process.bind(vault);let changed=false;vault.process=async(p,fn)=>{if(p===s.duoweiPath&&!changed){changed=true;const doc=JSON.parse(await vault.read(p));doc.fields=doc.fields.filter((f:any)=>f.id!=='custom_body');vault.files.set(p,JSON.stringify(doc));}await process(p,fn);};client.pending=[message()];
  assert.equal((await engine.sync(client,s)).failed,1);assert.equal(client.acks.length,0);assert.equal(JSON.parse(await vault.read(s.duoweiPath)).records.length,1);
});
