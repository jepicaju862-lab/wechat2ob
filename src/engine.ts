// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import { hash, messageKey, validateMessage, validateSettings, vaultPath, type Settings, type InboxClient, type VaultPort, type Journal, type Message, type SyncResult } from "./model";
import { prepareOutputs, writeOutputs, attachmentPath } from "./outputs";
import {randomUUID} from "node:crypto";
import {notePath,noteReceipt} from "./notes";
import {basePath,indexBaseText} from "./bases";
import {cleanLegacyText,cleanLegacyTableLinks} from "./cleanup";
import {backupMappedTable} from "./duowei";

export class SyncEngine {
  private active: Promise<SyncResult> | null=null;
  private stopped=false;
  constructor(private vault:VaultPort, private stateRoot:string, private clientId:string) {}
  get busy() { return this.active!==null; }
  stop() { this.stopped=true; }
  sync(client:InboxClient, settings:Settings): Promise<SyncResult> {
    return this.run(()=>this.poll(client,validateSettings({...settings})));
  }
  replay(client:InboxClient, settings:Settings): Promise<SyncResult> {
    return this.run(()=>this.rebuild(client,validateSettings({...settings})));
  }
  cleanup(client:InboxClient,settings:Settings):Promise<SyncResult> {
    return this.run(()=>this.clean(client,validateSettings({...settings})));
  }
  private run(work:()=>Promise<SyncResult>): Promise<SyncResult> {
    if (this.stopped) return Promise.reject(new Error("插件已停止"));
    if (this.active) return this.active;
    this.active=work().finally(()=>{this.active=null;});
    return this.active;
  }
  private check() { if (this.stopped) throw new Error("插件已停止，未确认尚未完成的消息"); }
  private stream(client:InboxClient) { return `${this.stateRoot}/${hash(client.endpoint)}`; }
  private async loadJournal(file:string, client:InboxClient, message:Message): Promise<Journal> {
    const key=messageKey(client.endpoint,message);
    if (!await this.vault.exists(file)) return {format:1,key,message,attachments:[],receipts:{},received:new Date().toISOString()};
    let j:Journal;
    try { j=JSON.parse(await this.vault.read(file)); } catch { throw new Error("本地同步日志损坏，已停止此消息确认；请从备份恢复"); }
    if (j.format!==1 || j.key!==key || !Array.isArray(j.attachments) || !j.receipts || typeof j.receipts!=="object") throw new Error("本地同步日志不匹配");
    validateMessage(j.message);
    return j;
  }
  private async materialize(client:InboxClient,s:Settings,j:Journal):Promise<void> {
    for (const a of j.message.attachments) {
      this.check();
      const destination=attachmentPath(s.root,j,a.id,a.filename);
      let bytes:ArrayBuffer;
      if (await this.vault.exists(destination)) bytes=await this.vault.readBinary(destination);
      else bytes=await client.downloadAttachment(a.id);
      this.check();
      if (bytes.byteLength!==a.byteSize || hash(new Uint8Array(bytes))!==a.sha256.toLowerCase()) throw new Error("附件大小或 SHA-256 不匹配，未确认此消息");
      if (!await this.vault.exists(destination)) {
        await this.vault.mkdir(destination.slice(0,destination.lastIndexOf("/")));
        await this.vault.createBinary(destination,bytes);
      }
      const saved={id:a.id,path:destination,kind:a.kind,mimeType:a.mimeType,sha256:a.sha256};
      const index=j.attachments.findIndex(item=>item.id===a.id);
      if (index>=0) j.attachments[index]=saved; else j.attachments.push(saved);
    }
  }
  private async accept(client:InboxClient,s:Settings,m:Message):Promise<void> {
    this.check();
    const folder=this.stream(client);
    const file=`${folder}/${messageKey(client.endpoint,m)}.json`;
    await this.vault.mkdir(folder);
    const j=await this.loadJournal(file,client,m);
    const checkpoint=async()=>{this.check(); await this.vault.write(file,JSON.stringify(j,null,2)+"\n");};
    await checkpoint(); // Persist before any sink; acknowledgment is always last.
    await this.materialize(client,s,j);
    await checkpoint();
    await backupMappedTable(this.vault,this.stateRoot,s,j);
    await writeOutputs(this.vault,s,j,checkpoint);
  }
  private result():SyncResult { return {fetched:0,completed:0,acknowledged:0,failed:0,errors:[]}; }
  private async clean(client:InboxClient,s:Settings):Promise<SyncResult> {
    const result=this.result(),folder=this.stream(client);
    if(!await this.vault.exists(folder))return result;
    const entries:{file:string;j:Journal}[]=[];
    for(const file of (await this.vault.list(folder)).files.filter(p=>/\/[a-f\d]{64}\.json$/.test(p))) {
      this.check();
      const raw=JSON.parse(await this.vault.read(file));
      if(file!==`${folder}/${messageKey(client.endpoint,validateMessage(raw.message))}.json`)throw new Error("本地日志路径不匹配，未清理");
      entries.push({file,j:await this.loadJournal(file,client,raw.message)});
    }
    const targets=new Map<string,typeof entries>(),tables=new Set<string>();
    for(const entry of entries) {
      const paths=new Set<string>([notePath(s,entry.j.message.receivedAt)]);
      for(const [key,receipt] of Object.entries(entry.j.receipts)) {
        if(key.startsWith("notes:") && receipt.path.endsWith(".md"))paths.add(vaultPath(receipt.path));
        if(key.startsWith("duowei:") && receipt.path.endsWith(".duowei"))tables.add(vaultPath(receipt.path));
      }
      for(const path of paths)targets.set(path,[...(targets.get(path)||[]),entry]);
    }
    const backupRoot=`${this.stateRoot}/backups/clean-${new Date().toISOString().replace(/[:.]/g,"-")}-${randomUUID()}`;
    const backups:{source:string;backup:string}[]=[];
    const replace=async(path:string,before:string,after:string)=>{
      if(before===after)return;
      this.check();await this.vault.mkdir(backupRoot);
      const backup=`${backupRoot}/${hash(path)}.${path.split('.').pop()}`;
      await this.vault.create(backup,before);
      backups.push({source:path,backup});
      await this.vault.write(`${backupRoot}/index.json`,JSON.stringify({format:1,files:backups},null,2)+"\n");
      result.backupRoot=backupRoot;this.check();
      await this.vault.process(path,latest=>{
        if(latest!==before)throw new Error(`笔记或视图正在编辑，已保留最新内容，请稍后重试：${path}`);
        return after;
      });
    };
    const indexed:string[]=[],links=new Map<string,Set<string>>();
    for(const [path,items] of targets) {
      this.check();if(!await this.vault.exists(path))continue;
      result.fetched++;
      try {
        if(items.some(e=>e.j.noteWrites?.[path]))throw new Error(`笔记有未完成写入，请先完成同步再清理：${path}`);
        const before=await this.vault.read(path),cleaned=cleanLegacyText(before,path,items.map(e=>e.j));
        // Move any old crash-recovery evidence into the private journal before removing it.
        for(const key of cleaned.keys) {
          const entry=items.find(e=>e.j.key===key)!;
          if(!entry.j.receipts[noteReceipt(path)]) {
            entry.j.receipts[noteReceipt(path)]={path,at:new Date().toISOString()};
            await this.vault.write(entry.file,JSON.stringify(entry.j,null,2)+"\n");
          }
        }
        await replace(path,before,cleaned.text);
        if(before!==cleaned.text)result.completed++;
        if(items.some(({j})=>j.receipts[noteReceipt(path)]))indexed.push(path);
        for(const {j} of items.filter(({j})=>j.receipts[noteReceipt(path)])) {
          const paths=links.get(j.key)||new Set<string>();paths.add(path);links.set(j.key,paths);
        }
      } catch(error) { result.failed++;result.errors.push(error instanceof Error?error.message:"清理失败"); }
    }
    if(s.bases && !result.failed && await this.vault.exists(basePath(s))) {
      const path=basePath(s),before=await this.vault.read(path);
      await replace(path,before,indexBaseText(before,indexed,this.vault));
    }
    for(const path of tables)if(await this.vault.exists(path)) {
      const before=await this.vault.read(path);
      await replace(path,before,cleanLegacyTableLinks(before,links));
    }
    return result;
  }
  private async poll(client:InboxClient,s:Settings):Promise<SyncResult> {
    const result=this.result();
    const messages=await client.listMessages(this.clientId,50);
    this.check();
    result.fetched=messages.length;
    if (!messages.length) return result; // Empty polling never scans or writes vault files.
    await prepareOutputs(this.vault,s);
    for (const value of messages) {
      this.check();
      try {
        const m=validateMessage(value);
        await this.accept(client,s,m);
        this.check();
        result.acknowledged+=await client.acknowledge(this.clientId,[m.id]);
        result.completed++;
      } catch(error) {
        if (this.stopped) throw error;
        result.failed++;
        result.errors.push(error instanceof Error?error.message:"同步失败");
      }
    }
    return result;
  }
  private async rebuild(client:InboxClient,s:Settings):Promise<SyncResult> {
    const result=this.result();
    const folder=this.stream(client);
    if (!await this.vault.exists(folder)) return result;
    await prepareOutputs(this.vault,s);
    const files=(await this.vault.list(folder)).files.filter(file=>/\/[a-f\d]{64}\.json$/.test(file));
    for (const file of files) {
      this.check(); result.fetched++;
      try {
        const j=JSON.parse(await this.vault.read(file)) as Journal;
        if (file!==`${folder}/${messageKey(client.endpoint,validateMessage(j.message))}.json`) throw new Error("同步日志路径不匹配");
        await this.accept(client,s,j.message); // Replays do not modify ANY upstream delivery cursor.
        result.completed++;
      } catch(error) { if(this.stopped) throw error; result.failed++; result.errors.push(error instanceof Error?error.message:"重建失败"); }
    }
    return result;
  }
}
