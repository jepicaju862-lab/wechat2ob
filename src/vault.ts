// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import { TFile, parseYaml, stringifyYaml, type App } from "obsidian";
import type { VaultPort } from "./model";
export class ObsidianVault implements VaultPort {
  constructor(private app:App) {}
  parseYaml(text:string):unknown { return parseYaml(text); }
  stringifyYaml(value:unknown):string { return stringifyYaml(value); }
  exists(path:string) { return this.app.vault.adapter.exists(path); }
  read(path:string) { return this.app.vault.adapter.read(path); }
  readBinary(path:string) { return this.app.vault.adapter.readBinary(path); }
  list(path:string) { return this.app.vault.adapter.list(path); }
  async mkdir(path:string) {
    let current="";
    for(const part of path.split("/")) {
      current=current?current+"/"+part:part;
      if(await this.exists(current)) continue;
      try {
        if(current===this.app.vault.configDir || current.startsWith(this.app.vault.configDir+"/")) await this.app.vault.adapter.mkdir(current);
        else await this.app.vault.createFolder(current);
      } catch(error) { if(!await this.exists(current)) throw error; }
    }
  }
  async create(path:string,content:string) {
    if(await this.exists(path)) throw new Error("文件已存在，拒绝覆盖："+path);
    if(path.startsWith(this.app.vault.configDir+"/")) await this.app.vault.adapter.write(path,content);
    else await this.app.vault.create(path,content);
  }
  async createBinary(path:string,content:ArrayBuffer) {
    if(await this.exists(path)) throw new Error("附件已存在，拒绝覆盖");
    await this.app.vault.createBinary(path,content);
  }
  async process(path:string,fn:(text:string)=>string) {
    const file=this.app.vault.getAbstractFileByPath(path);
    if(file instanceof TFile) await this.app.vault.process(file,fn);
    else await this.app.vault.adapter.process(path,fn);
  }
  async write(path:string,content:string) {
    if(await this.exists(path)) await this.process(path,()=>content);
    else await this.create(path,content);
  }
}
