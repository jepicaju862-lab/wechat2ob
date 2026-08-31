// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import { Notice, Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import { randomUUID } from "node:crypto";
import { setInterval as nodeInterval, clearInterval as clearNodeInterval } from "node:timers";
import { Client } from "./client";
import { localConnection } from "./connection";
import { SyncEngine } from "./engine";
import { DEFAULT_SETTINGS, hash, tokenSecretId, settingsFrom, validateSettings, type Settings } from "./model";
import {basePath} from "./bases";
import { notePath } from "./notes";
import { ObsidianVault } from "./vault";
import {checkDuoweiTarget,duoweiPath} from "./duowei";
import {renderDuoweiSettings} from "./duowei-settings";

export default class WeChat2Ob extends Plugin {
  settings:Settings={...DEFAULT_SETTINGS};
  engine!:SyncEngine;
  port!:ObsidianVault;
  clientId="";
  status="尚未同步";
  statusTone:"ok"|"error"="ok";
  private secretId="";
  private statusItem!:HTMLElement;
  private nextRun=0;
  private failures=0;
  private disposed=false;
  private configuring=false;
  async onload() {
    // Invalid saved settings are never silently replaced or pointed at another inbox.
    try { this.settings=settingsFrom(await this.loadData()); }
    catch { new Notice("WeChat2Ob 配置无效，插件未开始同步；请备份并修复本插件 data.json",10000); return; }
    const vaultIdentity=(this.app.vault.adapter as {getBasePath?:()=>string}).getBasePath?.() || this.app.vault.getName();
    const key="wechat2ob-client-"+hash(vaultIdentity).slice(0,24);
    let id=localStorage.getItem(key);
    if(!id || !/^wechat2ob-[a-f\d-]{36}$/.test(id)) { id="wechat2ob-"+randomUUID(); localStorage.setItem(key,id); }
    this.clientId=id;
    this.secretId=tokenSecretId(id);
    this.port=new ObsidianVault(this.app);
    this.engine=new SyncEngine(this.port,`${this.manifest.dir || this.app.vault.configDir+"/plugins/wechat2ob"}/state`,id);
    this.statusItem=this.addStatusBarItem();
    this.statusItem.addClass("wechat2ob-status");
    this.updateStatus("就绪");
    this.addSettingTab(new WeChat2ObSettings(this.app,this));
    this.addRibbonIcon("message-circle","WeChat2Ob：同步微信消息",()=>void this.sync(true));
    this.addCommand({id:"sync",name:"立即同步微信消息",callback:()=>void this.sync(true)});
    this.addCommand({id:"connect-local",name:"自动连接本机 WeChat2Ob 服务",callback:()=>void this.connect()});
    this.addCommand({id:"open-inbox",name:"打开收件箱",callback:()=>void this.openInbox()});
    this.addCommand({id:"pause",name:"暂停自动同步",callback:()=>void this.saveConfiguration({...this.settings,autoSync:false})});
    this.addCommand({id:"resume",name:"开启自动同步",callback:()=>void this.saveConfiguration({...this.settings,autoSync:true})});
    this.app.workspace.onLayoutReady(()=>{
      if(this.disposed) return;
      const timer=nodeInterval(()=>{
        if(!this.disposed && !this.configuring && this.settings.autoSync && this.token() && Date.now()>=this.nextRun && !this.engine.busy) void this.sync(false);
      },1000);
      this.register(()=>clearNodeInterval(timer));
    });
  }
  onunload() { this.disposed=true; this.engine?.stop(); }
  get busy() { return this.configuring || this.engine?.busy; }
  token():string { return this.app.secretStorage?.getSecret(this.secretId)?.trim() || ""; }
  setToken(value:string) {
    const token=value.trim();
    if(token.length>8192 || /[\r\n\0]/.test(token)) throw new Error("Token 格式无效");
    this.app.secretStorage.setSecret(this.secretId,token);
  }
  private updateStatus(text:string,tone:"ok"|"error"="ok") {
    this.status=text;
    this.statusTone=tone;
    this.statusItem?.setText(`微信：${text}`);
    this.statusItem?.setAttribute("aria-label",`WeChat2Ob：${text}`);
    this.statusItem?.toggleClass("wechat2ob-status-error",tone==="error");
  }
  async saveConfiguration(next:Settings) {
    if(this.busy) { new Notice("请等本次同步或配置操作完成后再修改设置"); return false; }
    this.configuring=true;
    try {
      const valid=validateSettings(next);
      if(valid.duowei)await checkDuoweiTarget(this.port,valid);
      await this.saveData(valid);
      this.settings=valid;
      this.nextRun=0;
      new Notice("设置已保存；后续消息将按新设置同步");
      return true;
    } catch(error) { this.report(error,true); return false; }
    finally { this.configuring=false; }
  }
  async connect() {
    if(this.busy) return;
    this.configuring=true;
    try {
      const c=await localConnection();
      await new Client(c.endpoint,c.apiToken).test(this.clientId);
      this.setToken(c.apiToken);
      const next={...this.settings,endpoint:c.endpoint,autoSync:true};
      await this.saveData(next); this.settings=next; this.nextRun=0;
      this.updateStatus("已连接本机服务");
      new Notice("已连接 WeChat2Ob 独立服务并开启自动同步",6000);
    } catch(error) { this.report(error,true); }
    finally { this.configuring=false; }
  }
  async sync(notify:boolean) {
    if(this.disposed || this.configuring) return;
    if(this.engine.busy) { if(notify) new Notice("微信同步正在进行"); return; }
    try {
      if(!this.token()) throw new Error("请先连接服务或保存本插件的 API Token");
      this.updateStatus("正在同步…");
      const client=new Client(this.settings.endpoint,this.token());
      const result=await this.engine.sync(client,this.settings);
      if(this.disposed) return;
      if(result.failed) throw new Error(`${result.failed} 条未完成，可重试；${result.errors[0]}`);
      this.failures=0;
      this.nextRun=Date.now()+this.settings.intervalSeconds*1000;
      this.updateStatus(`${new Date().toLocaleTimeString()} 已完成 ${result.completed} 条`);
      if(notify) new Notice(`WeChat2Ob：同步完成 ${result.completed} 条`,5000);
    } catch(error) {
      this.failures=Math.min(this.failures+1,6);
      this.nextRun=Date.now()+Math.min(60000,this.settings.intervalSeconds*1000*2**this.failures);
      if(!this.disposed) this.report(error,notify);
    }
  }
  private report(error:unknown,notify:boolean) {
    const text=error instanceof Error?error.message:"操作失败";
    this.updateStatus(text.slice(0,150),"error");
    if(notify) new Notice(`WeChat2Ob：${text}`,9000);
  }
  async openInbox() {
    const path=this.settings.bases?basePath(this.settings):this.settings.notes?notePath(this.settings,new Date().toISOString()):duoweiPath(this.settings);
    if(path && await this.port.exists(path)) await this.app.workspace.openLinkText(path,"",true);
    else new Notice(`目标尚未创建：${path}。收到消息后将自动追加；历史消息按其日期归档。`);
  }
}

class WeChat2ObSettings extends PluginSettingTab {
  private draft!:Settings;
  private statusBox!:HTMLElement;
  private saveBar!:HTMLElement;
  private saveHint!:HTMLElement;
  constructor(app:App,private plugin:WeChat2Ob) { super(app,plugin); }
  private get dirty():boolean { return JSON.stringify(this.draft)!==JSON.stringify(this.plugin.settings); }
  // Editing stays local until 保存设置; the bar keeps that visible instead of silently dropping edits.
  private touch() {
    const dirty=this.dirty;
    this.saveBar?.toggleClass("is-dirty",dirty);
    this.saveHint?.setText(dirty?"有未保存的改动":"设置均已保存");
  }
  private renderStatus() {
    const box=this.statusBox; box.empty();
    const connected=!!this.plugin.token();
    const tone=!connected?"warn":this.plugin.statusTone==="error"?"error":"ok";
    box.className="wechat2ob-card is-"+tone;
    const head=box.createDiv({cls:"wechat2ob-card-head"});
    head.createSpan({cls:"wechat2ob-dot"});
    head.createSpan({cls:"wechat2ob-card-title",text:!connected?"尚未连接收件服务":this.plugin.settings.autoSync?"已连接 · 自动同步开启":"已连接 · 自动同步已关闭"});
    box.createDiv({cls:"wechat2ob-card-sub",text:connected?this.plugin.status:"请先安装 WeChat2Ob 本机服务并用手机微信扫码，再点下方“自动连接本机服务”。"});
  }
  // Sync actions only change status; redrawing the whole tab would discard unsaved edits and scroll position.
  private async act(work:Promise<unknown>) { await work; this.renderStatus(); }
  display() {
    const {containerEl:c}=this; const scroll=c.scrollTop;
    c.empty(); c.addClass("wechat2ob-settings");
    this.draft={...this.plugin.settings,duoweiFieldMap:{...this.plugin.settings.duoweiFieldMap}};
    const d=this.draft;
    this.statusBox=c.createDiv(); this.renderStatus();

    new Setting(c).setName("连接").setHeading();
    new Setting(c).setName("本机独立服务").setDesc("先安装 WeChat2Ob 服务并扫码。自动连接只读取 WeChat2ObInbox，不接管旧多维表格服务。")
      .addButton(b=>b.setButtonText("自动连接本机服务").setCta().onClick(async()=>{await this.plugin.connect();this.display();}));
    const manual=c.createEl("details",{cls:"wechat2ob-fold"});
    manual.createEl("summary",{text:"手动填写服务地址与 Token（自动连接失败或使用远程服务时）"});
    new Setting(manual).setName("服务地址").setDesc("独立服务默认 http://127.0.0.1:7342；远程地址必须 HTTPS。更换服务后请更新 Token。")
      .addText(t=>t.setValue(d.endpoint).onChange(v=>{d.endpoint=v;this.touch();}));
    let token="";
    new Setting(manual).setName("本插件 API Token").setDesc(this.plugin.token()?"已保存在本设备 SecretStorage；不显示、不写入 data.json。":"尚未保存。这里不读取旧插件的 Token。")
      .addText(t=>{t.inputEl.type="password";t.setPlaceholder("粘贴新 Token").onChange(v=>{token=v;});})
      .addButton(b=>b.setButtonText("保存 Token").onClick(()=>{if(this.plugin.busy)return;try{if(!token.trim())throw new Error("Token 不能为空");this.plugin.setToken(token);this.display();}catch(e){new Notice(String(e));}}))
      .addButton(b=>b.setButtonText("清除").setWarning().onClick(()=>{if(this.plugin.busy)return;this.plugin.setToken("");this.display();}));
    manual.createEl("p",{cls:"wechat2ob-muted",text:"同一个 ClawBot 只运行一个收件服务；本插件不会接管原多维表格的微信同步。"});

    new Setting(c).setName("写入位置").setHeading();
    new Setting(c).setName("附件与视图目录").setDesc("存放附件、Base 及未指定路径时的默认表格；需使用空目录或本插件已有目录。日记和指定 .duowei 文件可位于其他已有目录。")
      .addText(t=>t.setValue(d.root).onChange(v=>{d.root=v;this.touch();}));

    new Setting(c).setName("Markdown 笔记").setDesc("仅将正文、转写和附件逐条追加到笔记末尾，以空行分隔；不添加标题、发送者、标签或隐藏标记。")
      .addToggle(t=>t.setValue(d.notes).onChange(v=>{d.notes=v;this.touch();notePanel();}));
    const noteBox=c.createDiv({cls:"wechat2ob-sub"});
    const notePanel=()=>{
      noteBox.empty();
      if(!d.notes && !d.bases) return;
      if(!d.notes && d.bases)noteBox.createEl("p",{cls:"wechat2ob-muted",text:"Bases 需要笔记作为数据源，仍按下面的方式写入。"});
      new Setting(noteBox).setName("写入方式").addDropdown(dd=>dd.addOption("daily","按日期写入日记").addOption("file","追加到指定文件").setValue(d.noteMode).onChange(v=>{d.noteMode=v as Settings["noteMode"];this.touch();notePanel();}));
      if(d.noteMode==="daily") {
        new Setting(noteBox).setName("日记目录").setDesc("可填写已有日记目录；文件名为 YYYY-MM-DD.md。留空写到库根目录，例如 日记/2026-08-31.md。")
          .addText(t=>t.setValue(d.dailyFolder).onChange(v=>{d.dailyFolder=v;this.touch();}));
        const advanced=noteBox.createEl("details",{cls:"wechat2ob-fold"});
        advanced.createEl("summary",{text:"日记时区"});
        new Setting(advanced).setName("时区").setDesc("默认 local（本机时区）；也可填 Asia/Shanghai 或 UTC。")
          .addText(t=>t.setValue(d.noteTimeZone).onChange(v=>{d.noteTimeZone=v;this.touch();}));
      } else {
        new Setting(noteBox).setName("指定 Markdown 笔记路径").setDesc("仅用于 .md 指定文件模式，例如 收件箱/微信.md；表格请在下方“目标 .duowei 文件”设置。笔记只在末尾追加。")
          .addText(t=>t.setValue(d.fixedNotePath).onChange(v=>{d.fixedNotePath=v;this.touch();}));
      }
    };
    notePanel();

    new Setting(c).setName("Obsidian Bases").setDesc("按收件笔记路径汇总，每个文件一行；不需要在正文添加标签。需启用核心 Bases。")
      .addToggle(t=>t.setValue(d.bases).onChange(v=>{d.bases=v;this.touch();notePanel();}));

    new Setting(c).setName(".duowei 表格输出").setDesc("一条消息新增一行。与 Markdown 的日记/指定笔记路径分开设置；选择目标后需保存设置。")
      .addToggle(t=>t.setValue(d.duowei).onChange(v=>{d.duowei=v;this.touch();duoweiPanel();}));
    const duoweiBox=c.createDiv({cls:"wechat2ob-sub"});
    const duoweiPanel=()=>{ duoweiBox.empty(); if(d.duowei) renderDuoweiSettings(this.app,duoweiBox,d,this.plugin.port,()=>this.touch()); };
    duoweiPanel();

    new Setting(c).setName("同步").setHeading();
    new Setting(c).setName("自动同步").setDesc("仅当 Obsidian 运行、服务可达时写入；初次安装默认关闭，自动连接成功后开启。")
      .addToggle(t=>t.setValue(d.autoSync).onChange(v=>{d.autoSync=v;this.touch();intervalPanel();}));
    const intervalBox=c.createDiv({cls:"wechat2ob-sub"});
    const intervalPanel=()=>{
      intervalBox.empty();
      if(!d.autoSync)return;
      new Setting(intervalBox).setName("同步间隔（秒）").setDesc("默认 3 秒；网络异常会自动重试。")
        .addText(t=>{t.inputEl.type="number";t.inputEl.min="3";t.inputEl.max="3600";t.inputEl.step="1";t.inputEl.addClass("wechat2ob-number");t.setValue(String(d.intervalSeconds)).onChange(v=>{d.intervalSeconds=Number(v);this.touch();});});
    };
    intervalPanel();

    this.saveBar=c.createDiv({cls:"wechat2ob-savebar"});
    this.saveHint=this.saveBar.createSpan({cls:"wechat2ob-savebar-hint"});
    this.saveBar.createEl("button",{cls:"wechat2ob-reset",text:"放弃改动"}).onclick=()=>this.display();
    this.saveBar.createEl("button",{text:"立即同步"}).onclick=()=>{
      if(this.dirty){new Notice("请先保存设置，再同步到新的写入位置");return;}
      void this.act(this.plugin.sync(true));
    };
    this.saveBar.createEl("button",{cls:"mod-cta",text:"保存设置"}).onclick=async()=>{if(await this.plugin.saveConfiguration(d))this.display();else{this.renderStatus();this.touch();}};
    this.touch();

    c.scrollTop=scroll;
  }
}
