// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {SyncEngine} from '../src/engine';
import {DEFAULT_SETTINGS,type VaultPort,type InboxClient,validateMessage} from '../src/model';
import {literal} from '../src/notes';

class DiskVault implements VaultPort {
  constructor(readonly root:string){}
  resolve(p:string){const value=path.resolve(this.root,p);assert.ok(value.startsWith(path.resolve(this.root)+path.sep));return value;}
  async exists(p:string){try{await fs.stat(this.resolve(p));return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
  read(p:string){return fs.readFile(this.resolve(p),'utf8');}
  async create(p:string,text:string){await fs.writeFile(this.resolve(p),text,{flag:'wx'});}
  async write(p:string,text:string){await fs.writeFile(this.resolve(p),text);}
  async process(p:string,fn:(s:string)=>string){await fs.writeFile(this.resolve(p),fn(await this.read(p)));}
  async mkdir(p:string){await fs.mkdir(this.resolve(p),{recursive:true});}
  async list(p:string){const entries=await fs.readdir(this.resolve(p),{withFileTypes:true});return {files:entries.filter(e=>e.isFile()).map(e=>p+'/'+e.name),folders:entries.filter(e=>e.isDirectory()).map(e=>p+'/'+e.name)};}
  async readBinary(p:string){const b=await fs.readFile(this.resolve(p));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;}
  async createBinary(p:string,b:ArrayBuffer){await fs.writeFile(this.resolve(p),Buffer.from(b),{flag:'wx'});}
}

test('real HTTP fixtures persist all formats and media to isolated disk without old plugin',async()=>{
  const vaultRoot=path.resolve('.artifacts/filesystem-qa-'+randomUUID());
  const connectionFile=path.resolve('.artifacts/qa-connection.json');
  // Only a synthetic marker is removed; it contains no real credential.
  if(await fs.stat(connectionFile).catch(()=>null))await fs.unlink(connectionFile);
  const child=spawn(process.execPath,['scripts/mock-service.mjs'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  const exited=new Promise<void>(resolve=>child.on('exit',()=>resolve()));
  let success=false;
  try {
    let info:any;
    for(let i=0;i<100;i++){try{info=JSON.parse(await fs.readFile(connectionFile,'utf8'));break;}catch{await delay(50);}}
    assert.equal(info?.fixture,true);
    const request=async(route:string,body?:unknown)=>{
      const r=await fetch(info.endpoint+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+info.apiToken,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
      assert.equal(r.ok,true);return r;
    };
    const client:InboxClient={endpoint:info.endpoint,test:async()=>await(await request('/v1/health')).json(),listMessages:async(id,limit=50)=>(await(await request('/v1/messages?'+new URLSearchParams({clientId:id,limit:String(limit)}))).json()).messages.map(validateMessage),acknowledge:async(id,ids)=>(await(await request('/v1/messages/ack',{clientId:id,messageIds:ids})).json()).acknowledged,downloadAttachment:async id=>await(await request('/v1/attachments/'+id)).arrayBuffer()};
    const vault=new DiskVault(vaultRoot),engine=new SyncEngine(vault,'.obsidian/plugins/wechat2ob/state','wechat2ob-disk-fixture');
    const settings={...DEFAULT_SETTINGS,duowei:true,noteTimeZone:'Asia/Shanghai'};
    const result=await engine.sync(client,settings);assert.equal(result.failed,0);assert.equal(result.completed,4);assert.equal(result.acknowledged,4);
    const doc=JSON.parse(await vault.read('WeChat2Ob/微信收件箱.duowei'));assert.equal(doc.records.length,4);
    const md=(await vault.list('日记')).files;assert.equal(md.length,1);const noteText=await vault.read(md[0]);assert.ok(!noteText.includes('wechat2ob:'));assert.ok(!noteText.includes('^wechat2ob-'));assert.ok(!noteText.includes('#wechat2ob/inbox'));assert.ok(!noteText.startsWith('#'));
    const media=(await vault.list('WeChat2Ob/附件/2026-08')).files;assert.equal(media.length,3);
    const wav=Buffer.from(await vault.readBinary(media.find(p=>p.endsWith('.wav'))!));assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),24000);
    const ownDone=await client.listMessages('wechat2ob-disk-fixture');assert.equal(ownDone.length,0);
    const oldConsumerPending=await client.listMessages('old-plugin-simulated-client');assert.equal(oldConsumerPending.length,4);
    for(const m of oldConsumerPending)assert.ok(noteText.includes(literal(m.content)),'each of the four message bodies must be present');
    assert.equal((await engine.sync(client,settings)).fetched,0);
    await fs.mkdir('.artifacts/examples',{recursive:true});
    await fs.writeFile('.artifacts/examples/微信笔记.base',await vault.read('WeChat2Ob/微信笔记.base'));
    await fs.writeFile('.artifacts/examples/微信收件箱.duowei',await vault.read('WeChat2Ob/微信收件箱.duowei'));
    await fs.writeFile('.artifacts/examples/示例笔记.md',await vault.read(md[0]));
    await fs.writeFile('.artifacts/filesystem-qa-result.json',JSON.stringify({root:vaultRoot,notes:1,noteMessageEntries:4,inlineMarkers:0,duoweiRecords:4,attachments:3,oldSimulatedClientUnaffected:true,realWeixinUsed:false},null,2));
    success=true;
  } finally {
    child.kill();await Promise.race([exited,delay(3000)]);
    // Keep the tiny synthetic vault for inspection; never touch a user's vault.
    if(!success)console.error('Fixture directory retained for diagnosis:',vaultRoot);
  }
});
