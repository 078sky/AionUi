/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid } from '@/common/utils';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { IGroupAgentRow, IGroupMessageRow, IGroupRoomRow } from '@process/services/database/types';
import type {
  GroupAgentRole,
  GroupAgentStatus,
  GroupMessageKind,
  GroupRoomStatus,
  IGroupMember,
  IGroupRoom,
} from './groupRoomTypes';

/**
 * Row shape returned by the seq MAX query
 */
type SeqRow = { max_seq: number | null };

/**
 * Service layer for group rooms. Uses better-sqlite3 synchronous API via ISqliteDriver.
 * No async — all operations are synchronous.
 */
export class GroupRoomService {
  constructor(private readonly db: ISqliteDriver) {}

  // ==================
  // Room operations
  // ==================

  /**
   * Create a new group room and insert the host agent record in a single transaction.
   */
  createRoom(params: { userId: string; name: string; description?: string; hostConversationId: string }): IGroupRoom {
    const now = Date.now();
    const roomId = uuid(36);
    const agentId = uuid(36);

    const insertRoom = this.db.prepare(`
      INSERT INTO group_rooms (id, user_id, name, description, host_conversation_id, status, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAgent = this.db.prepare(`
      INSERT INTO group_agents (id, room_id, role, agent_type, conversation_id, display_name, status, capabilities, current_task, created_at, terminated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const run = this.db.transaction(() => {
      insertRoom.run(
        roomId,
        params.userId,
        params.name,
        params.description ?? null,
        params.hostConversationId,
        'idle' satisfies GroupRoomStatus,
        '{}',
        now,
        now
      );

      insertAgent.run(
        agentId,
        roomId,
        'host',
        'host',
        params.hostConversationId,
        'Host',
        'idle',
        '{}',
        null,
        now,
        null
      );
    });

    run();

    return {
      id: roomId,
      userId: params.userId,
      name: params.name,
      description: params.description ?? null,
      hostConversationId: params.hostConversationId,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get room + member list. Returns null if room not found.
   */
  getRoom(roomId: string): { room: IGroupRoom; members: IGroupMember[] } | null {
    const roomRow = this.db.prepare('SELECT * FROM group_rooms WHERE id = ?').get(roomId) as IGroupRoomRow | undefined;

    if (!roomRow) return null;

    const agentRows = this.db
      .prepare('SELECT * FROM group_agents WHERE room_id = ? ORDER BY created_at ASC')
      .all(roomId) as IGroupAgentRow[];

    return {
      room: rowToRoom(roomRow),
      members: agentRows.map(rowToMember),
    };
  }

  /**
   * List all rooms owned by a user, ordered newest first.
   */
  listRooms(userId: string): IGroupRoom[] {
    const rows = this.db
      .prepare('SELECT * FROM group_rooms WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId) as IGroupRoomRow[];

    return rows.map(rowToRoom);
  }

  /**
   * Update room status.
   */
  updateRoomStatus(roomId: string, status: GroupRoomStatus): void {
    const now = Date.now();
    this.db.prepare('UPDATE group_rooms SET status = ?, updated_at = ? WHERE id = ?').run(status, now, roomId);
  }

  /**
   * Update agent status and current task in group_agents table.
   */
  updateAgentStatus(agentId: string, status: GroupAgentStatus, currentTask: string | null): void {
    this.db
      .prepare('UPDATE group_agents SET status = ?, current_task = ? WHERE id = ?')
      .run(status, currentTask, agentId);
  }

  /**
   * Delete a group room and all associated agents/messages (via CASCADE).
   * Also tears down any active orchestrator if provided.
   * Returns true if a row was actually deleted.
   */
  deleteRoom(roomId: string): boolean {
    const result = this.db.prepare('DELETE FROM group_rooms WHERE id = ?').run(roomId);
    return (result.changes ?? 0) > 0;
  }

  /**
   * Find the group room ID linked to a given host conversation.
   * Returns null if no group room uses this conversation as host.
   */
  findRoomByHostConversation(hostConversationId: string): string | null {
    const row = this.db.prepare('SELECT id FROM group_rooms WHERE host_conversation_id = ?').get(hostConversationId) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }

  // ==================
  // Message operations
  // ==================

  /**
   * Write a message to group_messages.
   * seq is computed atomically inside a transaction via MAX(seq)+1.
   * Returns the new message id.
   */
  addMessage(params: {
    roomId: string;
    senderType: 'user' | 'agent';
    senderId: string | null;
    msgKind: GroupMessageKind;
    content: string;
    refMessageId?: string;
    status?: string;
  }): string {
    const msgId = uuid(36);
    const now = Date.now();

    const getMaxSeq = this.db.prepare('SELECT MAX(seq) as max_seq FROM group_messages WHERE room_id = ?');

    const insertMsg = this.db.prepare(`
      INSERT INTO group_messages (id, room_id, sender_type, sender_id, msg_kind, content, ref_message_id, status, seq, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const run = this.db.transaction(() => {
      const seqRow = getMaxSeq.get(params.roomId) as SeqRow;
      const nextSeq = (seqRow.max_seq ?? 0) + 1;

      insertMsg.run(
        msgId,
        params.roomId,
        params.senderType,
        params.senderId,
        params.msgKind,
        params.content,
        params.refMessageId ?? null,
        params.status ?? null,
        nextSeq,
        now
      );
    });

    run();

    return msgId;
  }

  // ==================
  // Agent operations
  // ==================

  /**
   * Dynamically add a sub-agent (or host) member to an existing room.
   * Returns the newly created IGroupMember.
   */
  addAgent(params: {
    roomId: string;
    role: GroupAgentRole;
    agentType: string;
    displayName: string;
    conversationId: string | null;
  }): IGroupMember {
    const agentId = uuid(36);
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO group_agents (id, room_id, role, agent_type, conversation_id, display_name, status, capabilities, current_task, created_at, terminated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agentId,
        params.roomId,
        params.role,
        params.agentType,
        params.conversationId,
        params.displayName,
        'idle',
        '{}',
        null,
        now,
        null
      );

    return {
      id: agentId,
      roomId: params.roomId,
      role: params.role,
      agentType: params.agentType,
      conversationId: params.conversationId,
      displayName: params.displayName,
      status: 'idle',
      currentTask: null,
      createdAt: now,
    };
  }

  // ==================
  // Query helpers
  // ==================

  /**
   * Retrieve all messages in a room ordered by seq ASC.
   * Useful for testing and replay scenarios.
   */
  getMessagesByRoom(roomId: string): Array<{
    id: string;
    roomId: string;
    senderType: string;
    senderId: string | null;
    msgKind: GroupMessageKind;
    content: string;
    seq: number;
    createdAt: number;
  }> {
    const rows = this.db
      .prepare('SELECT * FROM group_messages WHERE room_id = ? ORDER BY seq ASC')
      .all(roomId) as IGroupMessageRow[];

    return rows.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      senderType: row.sender_type,
      senderId: row.sender_id,
      msgKind: row.msg_kind,
      content: row.content,
      seq: row.seq,
      createdAt: row.created_at,
    }));
  }
}

// ==================
// Row → domain converters
// ==================

function rowToRoom(row: IGroupRoomRow): IGroupRoom {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    hostConversationId: row.host_conversation_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMember(row: IGroupAgentRow): IGroupMember {
  return {
    id: row.id,
    roomId: row.room_id,
    role: row.role,
    agentType: row.agent_type,
    conversationId: row.conversation_id,
    displayName: row.display_name,
    status: row.status,
    currentTask: row.current_task,
    createdAt: row.created_at,
  };
}
