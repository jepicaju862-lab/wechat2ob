# Plugin API for other Obsidian plugins

WeChat2Ob exposes a small, versioned API so dashboards such as Home Pages can show
recent messages without reading this plugin's private `state/` journals or `data.json`.
The implementation is `src/api.ts`. The API never exposes tokens, endpoints or client IDs.

```ts
const api = app.plugins.plugins["wechat2ob"]?.api;   // undefined if disabled or settings are invalid
app.workspace.on("wechat2ob:ready", (api) => { /* the plugin (re)loaded */ });
app.workspace.on("wechat2ob:synced", () => { /* new messages were written; query again */ });
```

## Version 1

```ts
interface WeChat2ObApi {
  version: 1;
  query(options?: { days?: number; limit?: number; kinds?: string[] }): Promise<ApiInbox>;
  sync(): Promise<void>;      // same as the “sync now” command; feedback via notices and the status bar
  openInbox(): Promise<void>; // same as the “open inbox” command
}

interface ApiInbox {
  messages: ApiMessage[];     // newest first, filtered by days / kinds, at most limit
  today: number;              // messages received since local midnight (unfiltered)
  week: number;               // messages received in the last 7 days (unfiltered)
  attachments: number;        // attachments across all synced messages (unfiltered)
  pending: number | null;     // rows this plugin added to the table that are still “待整理”; null without table output
  todayNotePath: string;      // note today's messages go to; "" when Markdown output is off
  tablePath: string;          // .duowei inbox; "" when table output is off
  inboxRoot: string;          // inbox folder in the vault
}

interface ApiMessage {
  key: string;                // stable message key
  kind: string;               // text / image / voice / video / file / mixed
  title: string; content: string; transcript: string;
  receivedAt: string;         // ISO timestamp
  notePath?: string;          // note the message was appended to
  tablePath?: string;         // table the message was added to
  attachments: { path: string; kind: string; mimeType: string }[];  // vault paths
}
```

`days` defaults to 14 (0 = no limit, max 3650); `limit` defaults to 50 (1–200);
an empty `kinds` list means all kinds. Journals are read once and cached until the
next sync that fetched messages, so frequent dashboard redraws stay cheap.
`wechat2ob:synced` fires after such a sync, including a sync that partly failed.

Breaking changes increase `version`; new optional fields do not.
