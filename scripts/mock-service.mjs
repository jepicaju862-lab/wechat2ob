// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
// Isolated local fixtures only. No Weixin credentials, network calls or real messages.
import http from 'node:http';
import fs from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
const token='wechat2ob-local-fixture-only';
const wav=Buffer.alloc(44+4800*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<4800;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/24000)*4000),44+i*2);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=','base64');
const text=Buffer.from('WeChat2Ob attachment fixture.');
const attachments=new Map();
function attachment(kind,name,mime,bytes){const id=randomUUID();attachments.set(id,bytes);return {id,kind,filename:name,mimeType:mime,byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
const fixtures=[['text','文字同步验收','只属于独立测试库，不是真实微信消息。',[]],['image','图片附件验收','图片与文字同时保存。',[attachment('image','test.png','image/png',png)]],['voice','语音 WAV 验收','音频为本地合成测试信号。',[attachment('voice','test.wav','audio/wav',wav)]],['file','文件附件验收','验证文件下载、摘要和链接。',[attachment('file','说明.txt','text/plain',text)]]].map(([kind,title,content,list],index)=>({id:randomUUID(),sourceMessageId:'fixture-'+index,seq:String(index),senderId:'测试发送者',recipientId:'fixture-bot',sessionId:'fixture-session',kind,title,content,transcript:kind==='voice'?'测试转写文本':'',receivedAt:`2026-08-31T03:00:0${index}.000Z`,attachments:list}));
const deliveries=new Map();let requests=0;
const server=http.createServer(async(req,res)=>{
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.headers.authorization!==`Bearer ${token}`)return send(401,{error:'unauthorized'});
  const url=new URL(req.url,'http://127.0.0.1');requests++;
  if(url.pathname==='/v1/health')return send(200,{ok:true,serviceVersion:'0.1.0-fixture',accountConfigured:true,messageCount:fixtures.length});
  if(url.pathname==='/v1/messages'){const client=url.searchParams.get('clientId');const done=deliveries.get(client)||new Set();return send(200,{messages:fixtures.filter(m=>!done.has(m.id)).slice(0,Number(url.searchParams.get('limit')||50))});}
  if(url.pathname==='/v1/messages/ack'&&req.method==='POST'){let body='';for await(const c of req)body+=c;const data=JSON.parse(body);const done=deliveries.get(data.clientId)||new Set();data.messageIds.forEach(id=>done.add(id));deliveries.set(data.clientId,done);return send(200,{acknowledged:data.messageIds.length});}
  if(url.pathname.startsWith('/v1/attachments/')){const bytes=attachments.get(url.pathname.split('/').pop());if(!bytes)return send(404,{});res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length});return res.end(bytes);}
  if(url.pathname==='/fixture/stats')return send(200,{requests,clients:[...deliveries].map(([id,s])=>({id,acked:s.size}))});
  send(404,{});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await fs.mkdir('.artifacts',{recursive:true});
await fs.writeFile('.artifacts/qa-connection.json',JSON.stringify({endpoint:`http://127.0.0.1:${server.address().port}`,apiToken:token,fixture:true}));
console.log('Local fixture server ready on port '+server.address().port+'; no Weixin requests.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.closeAllConnections();server.close();});
