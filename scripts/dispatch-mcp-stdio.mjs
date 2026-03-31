#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Standalone stdio MCP server for GroupDispatch tool.
 *
 * Spawned by Claude CLI as a stdio MCP server. Communicates with
 * the main process TCP server via DISPATCH_PORT environment variable.
 *
 * TCP protocol: 4-byte big-endian length header + UTF-8 JSON body.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as net from 'node:net';

const DISPATCH_PORT = parseInt(process.env.DISPATCH_PORT || '0', 10);
const DISPATCH_MEMBERS = process.env.DISPATCH_MEMBERS || '[]';

if (!DISPATCH_PORT) {
  process.stderr.write('DISPATCH_PORT environment variable is required\n');
  process.exit(1);
}

// ── TCP helpers ──────────────────────────────────────────────────────────────

function sendTcpRequest(port, data) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      const json = JSON.stringify(data);
      const body = Buffer.from(json, 'utf-8');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length, 0);
      socket.write(Buffer.concat([header, body]));
    });

    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
    });

    socket.on('end', () => {
      if (buffer.length < 4) {
        reject(new Error('Incomplete TCP response'));
        return;
      }
      const bodyLen = buffer.readUInt32BE(0);
      if (buffer.length < 4 + bodyLen) {
        reject(new Error('Incomplete TCP response body'));
        return;
      }
      const jsonStr = buffer.subarray(4, 4 + bodyLen).toString('utf-8');
      try {
        resolve(JSON.parse(jsonStr));
      } catch (err) {
        reject(new Error(`Failed to parse TCP response: ${err.message}`));
      }
    });

    socket.on('error', (err) => {
      reject(new Error(`TCP connection error: ${err.message}`));
    });

    // Timeout after 5 minutes (sub-agent tasks can take a while)
    socket.setTimeout(300_000);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('TCP request timeout'));
    });
  });
}

// ── Build tool description ───────────────────────────────────────────────────

function buildToolDescription(membersJson) {
  let members = [];
  try {
    members = JSON.parse(membersJson);
  } catch {
    // ignore parse errors
  }

  const memberList = members.map((m) => `- ${m.displayName}: type=${m.agentType}, id=${m.id}`).join('\n');

  const agentSection = memberList ? `\nAvailable agent types and the tools they have access to:\n${memberList}\n` : '';

  return [
    'Launch a new agent to handle complex, multi-step tasks autonomously.',
    '',
    'The GroupDispatch tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.',
    agentSection,
    'When using the GroupDispatch tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used.',
    '',
    'When NOT to use the GroupDispatch tool:',
    '- If you want to read a specific file path, use the Read tool or the Glob tool instead of the GroupDispatch tool, to find the match more quickly',
    '- If you are searching for a specific class definition like "class Foo", use the Glob tool instead, to find the match more quickly',
    '- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the GroupDispatch tool, to find the match more quickly',
    '- Other tasks that are not related to the agent descriptions above',
    '',
    '',
    'Usage notes:',
    '- Always include a short description (3-5 words) summarizing what the agent will do',
    '- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses',
    '- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.',
    '- You can optionally run agents in the background using the run_in_background parameter. When an agent runs in the background, you will be automatically notified when it completes \u2014 do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.',
    "- **Foreground vs background**: Use foreground (default) when you need the agent's results before you can proceed \u2014 e.g., research agents whose findings inform your next steps. Use background when you have genuinely independent work to do in parallel.",
    "- To continue a previously spawned agent, use subagent_type with the agent's ID or name. The agent resumes with its full context preserved. Each GroupDispatch invocation starts fresh \u2014 provide a complete task description.",
    '- Provide clear, detailed prompts so the agent can work autonomously and return exactly the information you need.',
    "- The agent's outputs should generally be trusted",
    "- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent",
    '- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.',
    '- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple GroupDispatch tool use content blocks. For example, if you need to launch both a build-validator agent and a test-runner agent in parallel, send a single message with both tool calls.',
    '- You can optionally set `isolation: "worktree"` to run the agent in a temporary git worktree, giving it an isolated copy of the repository. The worktree is automatically cleaned up if the agent makes no changes; if changes are made, the worktree path and branch are returned in the result.',
  ].join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'aion-group-dispatch', version: '1.0.0' }, { capabilities: { tools: {} } });

const toolDescription = buildToolDescription(DISPATCH_MEMBERS);

server.tool(
  'GroupDispatch',
  toolDescription,
  {
    description: z.string().describe('A short (3-5 word) description of the task'),
    prompt: z.string().describe('The task for the agent to perform'),
    subagent_type: z.string().optional().describe('The type of specialized agent to use for this task'),
    run_in_background: z.boolean().optional().describe('Set to true to run this agent in the background.'),
  },
  async (args) => {
    try {
      const response = await sendTcpRequest(DISPATCH_PORT, {
        description: args.description,
        prompt: args.prompt,
        subagent_type: args.subagent_type,
        run_in_background: args.run_in_background,
      });

      if (response.error) {
        return {
          content: [{ type: 'text', text: `Error: ${response.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: response.result || '' }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
