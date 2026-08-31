// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import { requestUrl } from "obsidian";
import { normalizeEndpoint, validateMessage, type Health, type InboxClient, type Message } from "./model";
export class Client implements InboxClient {
  endpoint: string;
  constructor(endpoint: string, private token: string) { this.endpoint = normalizeEndpoint(endpoint); }
  private async request(route: string, body?: unknown) {
    if (!this.token.trim()) throw new Error("请先保存本插件的 API Token");
    const r = await requestUrl({url:this.endpoint+route, method:body===undefined?"GET":"POST", headers:{Authorization:`Bearer ${this.token}`, ...(body===undefined?{}:{"Content-Type":"application/json"})}, ...(body===undefined?{}:{body:JSON.stringify(body)}),throw:false});
    if (r.status < 200 || r.status >= 300) throw new Error(`微信服务请求失败（HTTP ${r.status}）`);
    return r;
  }
  async test(clientId: string): Promise<Health> {
    const health = (await this.request("/v1/health")).json as Health;
    await this.listMessages(clientId,1); // health alone does not check API credentials
    if (!health.ok || !health.accountConfigured) throw new Error("服务未就绪或尚未扫码登录");
    return health;
  }
  async listMessages(clientId: string, limit = 50): Promise<Message[]> {
    const data = (await this.request(`/v1/messages?${new URLSearchParams({clientId,limit:String(limit)})}`)).json;
    if (!Array.isArray(data?.messages)) throw new Error("服务没有返回消息数组");
    return data.messages.map(validateMessage);
  }
  async acknowledge(clientId: string, messageIds: string[]): Promise<number> {
    return Number((await this.request("/v1/messages/ack",{clientId,messageIds})).json.acknowledged) || 0;
  }
  async downloadAttachment(id: string): Promise<ArrayBuffer> { return (await this.request(`/v1/attachments/${encodeURIComponent(id)}`)).arrayBuffer; }
}
