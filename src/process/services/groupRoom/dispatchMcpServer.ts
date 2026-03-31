/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GroupDispatch MCP Server — TCP-backed dispatch server for group rooms.
 *
 * Architecture:
 *   1. Main process starts a TCP server on 127.0.0.1:random_port
 *   2. A stdio MCP script (scripts/dispatch-mcp-stdio.mjs) is registered
 *      as a stdio MCP server in session/new
 *   3. Claude CLI spawns the stdio script; when GroupDispatch tool is called,
 *      the script connects to this TCP server, sends the request, waits for response
 *   4. TCP handler in main process executes the sub-agent and returns the result
 *
 * TCP protocol: 4-byte big-endian length header + UTF-8 JSON body
 */

import * as net from 'node:net';
import * as path from 'node:path';
import type { IGroupMember } from '@process/services/groupRoom/groupRoomTypes';

/**
 * Resolve the project root directory.
 * Works in both Electron main process and standalone CLI mode.
 */
function resolveProjectRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron');
    return app.isPackaged ? process.resourcesPath : app.getAppPath();
  } catch {
    // Fallback for CLI mode (no Electron): walk up from __dirname
    // __dirname = .../src/process/services/groupRoom or .../dist/process/services/groupRoom
    return path.resolve(__dirname, '..', '..', '..', '..');
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type DispatchToolCall = {
  /** Short (3-5 word) description of the task */
  description: string;
  /** The task for the agent to perform */
  prompt: string;
  /** Agent type or existing member id */
  subagent_type?: string;
  /** Run in background (currently treated as foreground — reserved for future) */
  run_in_background?: boolean;
};

export type DispatchToolHandler = (call: DispatchToolCall) => Promise<string>;

// ── Stdio config type ─────────────────────────────────────────────────────────

export type StdioMcpConfig = {
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
};

// ── TCP message helpers ───────────────────────────────────────────────────────

function writeTcpMessage(socket: net.Socket, data: unknown): void {
  const json = JSON.stringify(data);
  const body = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

function createTcpMessageReader(onMessage: (msg: unknown) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);

  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const bodyLen = buffer.readUInt32BE(0);
      if (buffer.length < 4 + bodyLen) break;

      const jsonStr = buffer.subarray(4, 4 + bodyLen).toString('utf-8');
      buffer = buffer.subarray(4 + bodyLen);

      try {
        const msg = JSON.parse(jsonStr);
        onMessage(msg);
      } catch {
        // Malformed JSON — skip
      }
    }
  };
}

// ── Tool description ───────────────────────────────────────────────────────────

function buildMemberListJson(members: IGroupMember[]): string {
  const subMembers = members
    .filter((m) => m.role === 'sub')
    .map((m) => ({
      displayName: m.displayName,
      agentType: m.agentType,
      id: m.id,
    }));
  return JSON.stringify(subMembers);
}

// ── MCP Server (TCP-backed) ──────────────────────────────────────────────────

export class DispatchMcpServer {
  private tcpServer: net.Server | null = null;
  private _port = 0;
  private _members: IGroupMember[] = [];
  private _handler: DispatchToolHandler | null = null;

  get port(): number {
    return this._port;
  }

  /**
   * Start the TCP server on a random available port.
   *
   * @param members  Current room members (for building the tool description).
   * @param handler  Callback invoked when the stdio script forwards a GroupDispatch call.
   */
  async start(members: IGroupMember[], handler: DispatchToolHandler): Promise<void> {
    this._members = members;
    this._handler = handler;

    this.tcpServer = net.createServer((socket) => {
      this.handleTcpConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      this.tcpServer!.listen(0, '127.0.0.1', () => {
        const addr = this.tcpServer!.address();
        if (addr && typeof addr === 'object') {
          this._port = addr.port;
        }
        resolve();
      });
      this.tcpServer!.once('error', reject);
    });
  }

  /**
   * Get the stdio MCP server configuration to inject into session/new.
   */
  getStdioConfig(): StdioMcpConfig {
    const root = resolveProjectRoot();
    const scriptPath = path.join(root, 'scripts', 'dispatch-mcp-stdio.mjs');

    return {
      name: 'aion-group-dispatch',
      command: 'node',
      args: [scriptPath],
      env: [
        { name: 'DISPATCH_PORT', value: String(this._port) },
        { name: 'DISPATCH_MEMBERS', value: buildMemberListJson(this._members) },
      ],
    };
  }

  /**
   * Stop the TCP server and release the port.
   */
  async stop(): Promise<void> {
    if (this.tcpServer) {
      await new Promise<void>((resolve) => {
        this.tcpServer!.close(() => resolve());
      });
      this.tcpServer = null;
    }
    this._port = 0;
    this._handler = null;
  }

  // ── TCP connection handler ──────────────────────────────────────────────────

  private handleTcpConnection(socket: net.Socket): void {
    const reader = createTcpMessageReader(async (msg) => {
      if (!this._handler) {
        writeTcpMessage(socket, { error: 'No handler registered' });
        socket.end();
        return;
      }

      const request = msg as {
        description?: string;
        prompt?: string;
        subagent_type?: string;
        run_in_background?: boolean;
      };

      try {
        const result = await this._handler({
          description: request.description ?? '',
          prompt: request.prompt ?? '',
          subagent_type: request.subagent_type,
          run_in_background: request.run_in_background,
        });
        writeTcpMessage(socket, { result });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        writeTcpMessage(socket, { error: errMsg });
      }
      socket.end();
    });

    socket.on('data', reader);
    socket.on('error', () => {
      // Connection errors are expected (e.g., client disconnect)
    });
  }
}
