# Client HTTP contract

This documents what the open-source client consumes. It is not the production
backend implementation, a promise of upstream WeChat access, or an installer.
See `src/client.ts`, `src/model.ts` and the synthetic `scripts/mock-service.mjs`.

## Transport and authentication

The user supplies the endpoint and a Bearer API Token. All client requests include
`Authorization: Bearer <token>`. POST requests use `application/json`.
Non-loopback endpoints require HTTPS. URLs cannot embed credentials, a query or a
fragment. Secrets must never be included in issue reports or committed files.

| Method | Route | Response / behavior |
| --- | --- | --- |
| GET | `/v1/health` | `{ok, serviceVersion, accountConfigured, messageCount}` |
| GET | `/v1/messages?clientId=...&limit=50` | `{messages: Message[]}`; unacknowledged deliveries for that client |
| POST | `/v1/messages/ack` | Body `{clientId, messageIds}`; response `{acknowledged: number}` |
| GET | `/v1/attachments/{id}` | Raw bytes matching the declared attachment size and SHA-256 |

The client checks both health and an authenticated message-list request before
accepting automatic connection. Success responses must use a 2xx HTTP status.
Delivery acknowledgement must be independent for each client; acknowledging one
client must not consume another client's deliveries. Acknowledgements should be
idempotent. The client commits all selected local outputs before acknowledging.

## Message

```ts
interface Message {
  id: string;
  sourceMessageId: string;
  seq: string;
  senderId: string;
  recipientId: string;
  sessionId: string;
  kind: string;
  title: string;
  content: string;
  transcript: string;
  receivedAt: string;
  attachments: Attachment[];
}
interface Attachment {
  id: string;
  kind: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}
```

All message scalar fields are strings (empty strings are allowed except where
validated otherwise). `id` and attachment IDs contain 8–64 hexadecimal characters
or hyphens. `sourceMessageId` is nonempty; `receivedAt` starts with an ISO date and
must parse as a valid timestamp. Each scalar is limited to 2,000,000 characters.
There may be at most 100 attachments per message with unique IDs. Each attachment
has an integer size from 1 through 100 MiB and a 64-character hexadecimal SHA-256.

The client stores a deduplication key derived from the normalized endpoint and
message ID. Changing an endpoint or client identifier can change the progress
namespace. Preserve stable IDs when a service re-delivers pending messages.

## Optional local discovery

The plugin reads an already installed WeChat2Ob service's `connection.json`
only when the user requests automatic local connection. Its shape is:

```json
{
  "format": 1,
  "product": "wechat2ob-inbox",
  "endpoint": "http://127.0.0.1:7342",
  "apiToken": "<your-local-service-token>"
}
```

Automatic discovery accepts only HTTP on `127.0.0.1` without a path, query,
fragment or URL credentials. The file is limited to 16 KiB. Its Token must be
nonempty, at most 8192 characters and contain no CR, LF or NUL.
The service's file and production credentials are never included in this repository.

The development fixture uses a random loopback port and an explicitly synthetic
Token. `npm test` starts and stops it; it does not contact WeChat or load a real
service connection file. The fixture is not suitable for production deployment.
