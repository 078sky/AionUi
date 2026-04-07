# Lark Integration Plan

> This document describes the complete development plan for Lark platform integration, extending the existing Telegram plugin architecture.

---

## 1. Feature Overview

### 1.1 Basic Information

- **Feature Name**: Lark Bot Integration
- **Module**: Channel Plugin layer
- **Process**: Main process
- **Runtime Environment**: GUI mode (while AionUi is running)
- **Dependencies**: Existing Channel architecture, PairingService, SessionManager

### 1.2 Feature Description

1. Reuse the existing Channel plugin architecture to add Lark platform support
2. Users can converse with AionUi through the Lark bot
3. Supports multi-agent switching: Gemini, Claude, Codex, etc.
4. Fully aligned with the Telegram feature set

### 1.3 User Scenario

```
Trigger: User @-mentions AionBot in Lark or sends a direct message
Flow:    Lark bot receives message → forwarded to Aion Agent → processed by LLM
Result:  Response pushed to the user via a Lark Message Card
```

### 1.4 Reference Resources

- **Lark Open Platform**: https://open.feishu.cn/
- **Node SDK**: https://github.com/larksuite/node-sdk
- **Existing Implementation**: `src/channels/plugins/telegram/`

---

## 2. Technology Decisions

### 2.1 Platform Comparison

| Item               | Telegram                         | Lark                                |
| ------------------ | -------------------------------- | ----------------------------------- |
| **Bot Library**    | grammY                           | @larksuiteoapi/node-sdk             |
| **Runtime Mode**   | Polling / Webhook                | WebSocket long-connection / Webhook |
| **Auth Method**    | Bot Token                        | App ID + App Secret                 |
| **UI Components**  | Inline Keyboard + Reply Keyboard | Message Card                        |
| **Message Format** | Markdown / HTML                  | Rich Text / Message Card JSON       |
| **Streaming**      | editMessageText                  | PATCH /im/v1/messages/:id           |

### 2.2 Technology Choices

| Item           | Choice                  | Notes                                         |
| -------------- | ----------------------- | --------------------------------------------- |
| SDK            | @larksuiteoapi/node-sdk | Official Node.js SDK                          |
| Runtime Mode   | WebSocket (preferred)   | No public IP required; ideal for desktop apps |
| Message Format | Message Card            | Supports rich text and interactive buttons    |

---

## 3. Configuration Flow

### 3.1 Creating the Lark Application

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Create Application                                  │
│   Lark Open Platform → Create Enterprise App → Get App ID/Secret │
├─────────────────────────────────────────────────────────────┤
│ Step 2: Enable Bot Capability                               │
│   App Capabilities → Bot → Enable                           │
├─────────────────────────────────────────────────────────────┤
│ Step 3: Configure Permissions                               │
│   Permission Management → Add the following permissions:    │
│   • im:message (send/receive DM and group messages)         │
│   • im:message.group_at_msg (receive @-mention messages)    │
│   • im:chat (access group information)                      │
│   • contact:user.id:readonly (read user IDs)                │
├─────────────────────────────────────────────────────────────┤
│ Step 4: Publish the Application                             │
│   Version Management → Create Version → Submit for Publishing │
├─────────────────────────────────────────────────────────────┤
│ Step 5: Configure AionUi                                    │
│   Settings → Channels → Lark → Paste App ID/Secret → Start │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Configuration Fields

| Field         | Type                 | Description                           | Required |
| ------------- | -------------------- | ------------------------------------- | :------: |
| App ID        | string               | Lark application ID                   |    ✅    |
| App Secret    | string               | Lark application secret key           |    ✅    |
| Runtime Mode  | websocket / webhook  | Event delivery mode                   |    ✅    |
| Webhook URL   | string               | Required only in webhook mode         |    ❌    |
| Pairing Mode  | boolean              | Whether pairing-code auth is required |    ✅    |
| Rate Limit    | number               | Maximum messages per minute           |    ❌    |
| Default Agent | gemini / acp / codex | Default agent to use                  |    ✅    |

---

## 4. Pairing Security Mechanism

### 4.1 Flow Design (mirrors Telegram)

```
┌─────────────────────────────────────────────────────────────┐
│ ① User initiates in Lark                                    │
│    User → @AionBot: any message                             │
├─────────────────────────────────────────────────────────────┤
│ ② Bot responds with a pairing request (Message Card)        │
│    ┌────────────────────────────────────────┐               │
│    │ 👋 Welcome to Aion Assistant!          │               │
│    │                                        │               │
│    │ 🔑 Pairing Code: ABC123               │               │
│    │ Please approve this pairing in AionUi  │               │
│    │                                        │               │
│    │ [📖 User Guide]  [🔄 Refresh Status]  │               │
│    └────────────────────────────────────────┘               │
├─────────────────────────────────────────────────────────────┤
│ ③ AionUi displays the pending approval request              │
│    Settings page shows: username, pairing code, request     │
│    time, [Approve] / [Reject]                               │
├─────────────────────────────────────────────────────────────┤
│ ④ User clicks [Approve] in AionUi                           │
├─────────────────────────────────────────────────────────────┤
│ ⑤ Bot sends pairing success message                         │
│    Bot → User: "✅ Paired! You can start chatting now."     │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Security Measures

| Mechanism             | Description                                   |
| --------------------- | --------------------------------------------- |
| Pairing code auth     | 6-character random code, valid for 10 minutes |
| Local approval        | Must be approved in AionUi, not in Lark       |
| User whitelist        | Only authorized users can interact            |
| Rate limiting         | Prevents abuse                                |
| Encrypted credentials | App Secret stored encrypted                   |

---

## 5. Message Conversion Rules

### 5.1 Inbound (Lark → Unified Format)

| Lark Event Type                 | Unified message `content.type` |
| ------------------------------- | ------------------------------ |
| `im.message.receive_v1` (text)  | `text`                         |
| `im.message.receive_v1` (image) | `image`                        |
| `im.message.receive_v1` (file)  | `file`                         |
| `im.message.receive_v1` (audio) | `audio`                        |
| `card.action.trigger`           | `action`                       |

### 5.2 Outbound (Unified Format → Lark)

| Unified message type | Lark API                  | content_type |
| -------------------- | ------------------------- | ------------ |
| `text`               | POST /im/v1/messages      | text         |
| `image`              | POST /im/v1/messages      | image        |
| `buttons`            | POST /im/v1/messages      | interactive  |
| Streaming update     | PATCH /im/v1/messages/:id | -            |

### 5.3 Message Card Structure

```json
{
  "config": {
    "wide_screen_mode": true
  },
  "header": {
    "title": {
      "tag": "plain_text",
      "content": "Aion Assistant"
    }
  },
  "elements": [
    {
      "tag": "markdown",
      "content": "Message content..."
    },
    {
      "tag": "action",
      "actions": [
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "🆕 New Chat" },
          "type": "primary",
          "value": { "action": "session.new" }
        }
      ]
    }
  ]
}
```

---

## 6. Interaction Design

### 6.1 Component Mapping

| Scenario               | Telegram              | Lark                             |
| ---------------------- | --------------------- | -------------------------------- |
| **Persistent actions** | Reply Keyboard        | Message Card bottom button group |
| **Message actions**    | Inline Keyboard       | Message Card interactive buttons |
| **Pairing request**    | Text + buttons        | Message Card                     |
| **AI response**        | Markdown + buttons    | Rich text / Card + buttons       |
| **Settings menu**      | Multi-level Inline KB | Message Card                     |

### 6.2 Interaction Scenarios

**Scenario 1: Main menu after successful pairing**

```
┌─────────────────────────────────────────────────────────────┐
│                    Message Card                             │
├─────────────────────────────────────────────────────────────┤
│  ✅ Paired! You can start chatting now.                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ [🆕 New Chat]  [🔄 Agent]  [📊 Status]  [❓ Help]   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Scenario 2: AI response with action buttons**

````
┌─────────────────────────────────────────────────────────────┐
│                    Message Card                             │
├─────────────────────────────────────────────────────────────┤
│  Here is a quicksort implementation:                        │
│                                                             │
│  ```python                                                  │
│  def quicksort(arr):                                        │
│      if len(arr) <= 1:                                      │
│          return arr                                         │
│      ...                                                    │
│  ```                                                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ [📋 Copy]  [🔄 Regenerate]  [💬 Continue]           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
````

**Scenario 3: Agent switching**

```
┌─────────────────────────────────────────────────────────────┐
│                    Message Card                             │
├─────────────────────────────────────────────────────────────┤
│  🔄 Switch Agent                                            │
│                                                             │
│  Select an AI Agent:                                        │
│  Current: 🤖 Gemini                                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ [✓ 🤖 Gemini]  [🧠 Claude]  [⚡ Codex]              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. File Structure

```
src/channels/
├── plugins/
│   ├── telegram/              # Existing Telegram plugin
│   │   ├── TelegramPlugin.ts
│   │   ├── TelegramAdapter.ts
│   │   ├── TelegramKeyboards.ts
│   │   └── index.ts
│   │
│   └── lark/                  # New Lark plugin
│       ├── LarkPlugin.ts      # Main plugin class
│       ├── LarkAdapter.ts     # Message format conversion
│       ├── LarkCards.ts       # Message card templates
│       └── index.ts
│
├── types.ts                   # Add 'lark' to PluginType union
└── ...
```

---

## 8. Interface Design

### 8.1 LarkPlugin Class

```typescript
class LarkPlugin extends BasePlugin {
  // Lifecycle
  async initialize(config: LarkPluginConfig): Promise<void>;
  async start(): Promise<void>;
  async stop(): Promise<void>;

  // Message handling
  async sendMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<string>;
  async editMessage(chatId: string, messageId: string, message: IUnifiedOutgoingMessage): Promise<void>;

  // Event handling
  private handleMessageEvent(event: LarkMessageEvent): void;
  private handleCardAction(action: LarkCardAction): void;

  // Token management
  private async refreshAccessToken(): Promise<void>;
}
```

### 8.2 Configuration Interface

```typescript
interface LarkPluginConfig {
  appId: string;
  appSecret: string;
  mode: 'websocket' | 'webhook';
  webhookUrl?: string;
  encryptKey?: string; // Event encryption key
  verificationToken?: string; // Event verification token
}
```

---

## 9. Lark-Specific Considerations

| Item                   | Notes                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| **App Type**           | Enterprise (self-built) app recommended; personal apps have feature limits |
| **Permission Review**  | Some permissions require admin approval                                    |
| **Card Size Limit**    | Message Card JSON max 30 KB; long messages must be chunked                 |
| **Token Refresh**      | Access Token expires in 2 hours; requires automatic refresh                |
| **Event Subscription** | WebSocket mode needs no public IP; ideal for desktop apps                  |
| **@-mention**          | In group chats, the bot must be @-mentioned to receive messages            |

---

## 10. Development Plan

### Phase 1: Basic Connectivity (est. 2–3 days)

- [ ] Create LarkPlugin base class
- [ ] Implement WebSocket event reception
- [ ] Implement automatic Access Token refresh
- [ ] Basic message send/receive

### Phase 2: Security & Auth (est. 1–2 days)

- [ ] Reuse PairingService
- [ ] Pairing flow message cards
- [ ] Settings page UI adaptation

### Phase 3: Full Interaction (est. 2–3 days)

- [ ] Message card template system
- [ ] Button callback handling
- [ ] Agent switching
- [ ] Streaming response support

### Phase 4: Polish (est. 1–2 days)

- [ ] Long message chunking
- [ ] Comprehensive error handling
- [ ] Multi-language support
- [ ] Logging & monitoring

---

## 11. Feature Alignment Checklist

| Feature               | Telegram | Lark | Reused Component      |
| --------------------- | :------: | :--: | --------------------- |
| Bot config validation |    ✅    |  🔲  | -                     |
| Bot start/stop        |    ✅    |  🔲  | ChannelManager        |
| Pairing code auth     |    ✅    |  🔲  | PairingService        |
| Local approval flow   |    ✅    |  🔲  | Existing UI           |
| User whitelist        |    ✅    |  🔲  | Database              |
| Button interactions   |    ✅    |  🔲  | SystemActions         |
| Streaming response    |    ✅    |  🔲  | ChannelMessageService |
| Agent switching       |    ✅    |  🔲  | SystemActions         |
| New session           |    ✅    |  🔲  | SessionManager        |
| Rate limiting         |    ✅    |  🔲  | RateLimiter           |

---

## 12. Acceptance Criteria

### 12.1 Functional Acceptance

- [ ] Lark app credential configuration and validation
- [ ] Bot start/stop control
- [ ] Pairing code generation and local approval flow
- [ ] Authorized user management
- [ ] Message card interactions
- [ ] Conversations with Gemini/Claude agents
- [ ] Agent switching
- [ ] New session creation
- [ ] Streaming message responses

### 12.2 Security Acceptance

- [ ] Pairing code expires after 10 minutes
- [ ] Approval must happen locally in AionUi
- [ ] Unauthorized users cannot access the bot
- [ ] App Secret stored encrypted
- [ ] Rate limiting enforced

### 12.3 Compatibility

- [ ] Runs correctly on macOS
- [ ] Runs correctly on Windows
- [ ] Multi-language support

---

## Document Maintenance

- **Created**: 2026-01-30
- **Last Updated**: 2026-01-30
- **Applicable Version**: AionUi v0.x+
- **Maintainer**: Project Team
