// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import {FuzzySuggestModal,Notice,Setting,type App,type TFile} from "obsidian";
import {vaultPath,type Settings,type VaultPort} from "./model";
import {duoweiPath,fieldMappingIssue,fieldNames,fieldTypeNames,inspectDuowei,suggestFieldMap} from "./duowei";

class TablePicker extends FuzzySuggestModal<TFile> {
  constructor(app:App,private choose:(file:TFile)=>void) {super(app);this.setPlaceholder("搜索库内 .duowei 文件");}
  getItems(){return this.app.vault.getFiles().filter(file=>file.extension.toLowerCase()==="duowei");}
  getItemText(file:TFile){return file.path;}
  onChooseItem(file:TFile){this.choose(file);}
}

// The output toggle lives in the settings tab so it can show or hide this panel; touch() marks the draft unsaved.
export function renderDuoweiSettings(app:App,container:HTMLElement,draft:Settings,vault:VaultPort,touch:()=>void=()=>{}):void {
  let fields:any[]=[];
  const panel=container.createDiv({cls:"wechat2ob-table-settings"});
  const read=async()=>{
    try {
      const path=vaultPath(duoweiPath(draft));
      if(!path.toLowerCase().endsWith(".duowei"))throw new Error("请选择 .duowei 文件");
      if(!await vault.exists(path))throw new Error("文件尚不存在；请选择“新建 / WeChat2Ob 表格”，保存后首次收件时会自动创建");
      const doc=inspectDuowei(await vault.read(path));
      if(vaultPath(duoweiPath(draft))!==path)throw new Error("读取期间目标路径已改变，请重新读取字段");
      draft.duoweiFieldMap=suggestFieldMap(doc,draft.duoweiTableId===doc.id?draft.duoweiFieldMap:{});
      draft.duoweiTableId=doc.id;fields=doc.fields;
      draft.duoweiMode=doc.meta.wechat2ob===1?"managed":"mapped";
      touch();
      render();
      new Notice("已只读检查表格；请确认字段映射后保存设置。未修改表格或同步目标。");
    } catch(error) { new Notice(error instanceof Error?error.message:"读取表格失败"); }
  };
  const render=()=>{
    panel.empty();
    new Setting(panel).setName("表格写入方式").addDropdown(d=>d.addOption("managed","新建 / WeChat2Ob 表格").addOption("mapped","已有表格（字段映射）").setValue(draft.duoweiMode).onChange(v=>{draft.duoweiMode=v as Settings["duoweiMode"];touch();render();}));
    new Setting(panel).setName("目标 .duowei 文件").setDesc("填写库内相对路径，例如 收件箱/微信消息.duowei；留空使用附件与视图目录下的微信收件箱.duowei。已有目录允许使用；不会覆盖已有文件。").addText(t=>t.setPlaceholder(`${draft.root}/微信收件箱.duowei`).setValue(draft.duoweiPath).onChange(v=>{draft.duoweiPath=v;draft.duoweiTableId="";draft.duoweiFieldMap={};fields=[];touch();mapping();})).addButton(b=>b.setButtonText("选择已有文件").onClick(()=>new TablePicker(app,file=>{draft.duoweiPath=file.path;draft.duoweiTableId="";draft.duoweiFieldMap={};fields=[];touch();render();void read();}).open()));
    if(draft.duoweiMode==="mapped")new Setting(panel).setName("表格字段").setDesc("可复用已有微信收件表。只追加本插件的消息并防止自身重复写入，保留原记录、字段和视图。").addButton(b=>b.setButtonText("读取字段").onClick(()=>void read()));
    mappingPanel=panel.createDiv();mapping();
  };
  let mappingPanel:HTMLElement;
  const mapping=()=>{
    if(!mappingPanel)return;
    mappingPanel.empty();
    if(draft.duoweiMode!=="mapped")return;
    mappingPanel.createEl("p",{text:"左侧是消息内容，右侧是所选表格的实际字段。正文必选；灰色项表示类型不兼容或已被其他项使用。"});
    if(!fields.length){mappingPanel.createEl("p",{text:"点击读取字段，查看或调整映射。已有映射在重新读取前保留，但更换目标后必须重新读取。"});return;}
    const selectors:{key:string,select:HTMLSelectElement}[]=[];
    const refreshCandidates=()=>{
      for(const {key,select} of selectors)for(const option of Array.from(select.options)) {
        const field=fields.find(f=>f.id===option.value);
        if(!field)continue;
        const issue=fieldMappingIssue(field,key,draft.duoweiFieldMap);
        option.textContent=`${field.name}（${fieldTypeNames[field.type]||field.type}）${issue?` · ${issue}`:""}`;
        option.disabled=!!issue;
      }
    };
    const renderField=(target:HTMLElement,key:string)=>new Setting(target).setName(`${fieldNames[key]}${key==="content"?"（必选）":""}`).addDropdown(d=>{
      d.addOption("",key==="content"?"请选择正文字段":"不写入此项");
      for(const field of fields)d.addOption(field.id,field.name);
      const selected=draft.duoweiFieldMap[key]||"";
      if(selected&&!fields.some(f=>f.id===selected))d.addOption(selected,"原字段已删除，请重新选择");
      d.setValue(selected).onChange(v=>{draft.duoweiFieldMap={...draft.duoweiFieldMap,[key]:v};refreshCandidates();touch();});
      selectors.push({key,select:d.selectEl});
    });
    renderField(mappingPanel,"content");
    const optional=mappingPanel.createEl("details",{cls:"wechat2ob-fold"});
    optional.createEl("summary",{text:"其他字段（可选）"});
    for(const key of Object.keys(fieldNames).filter(key=>key!=="content"))renderField(optional,key);
    refreshCandidates();
    mappingPanel.createEl("p",{text:"类型和状态支持单选/多选，按名称匹配表内已有选项；状态写入“待整理”。不新增或改写表格选项。",cls:"wechat2ob-muted"});
  };
  render();
}
