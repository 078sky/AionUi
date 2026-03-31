/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Layout as ArcoLayout, Tabs } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import MemberPanel from './components/MemberPanel';
import GroupRoomSendBox from './components/GroupRoomSendBox';
import GroupMessageItem from './components/GroupMessageItem';
import AgentTabContent from './components/AgentTabContent';
import { GroupRoomProvider, useGroupRoom, useGroupRoomActions } from './context/GroupRoomContext';
import type { GroupRoomInfo, GroupMember, GroupMessage } from './types';
import styles from './GroupRoomPage.module.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAIN_TAB_KEY = '__main__';

/** msgKind values that appear in the main conversation panel.
 * Includes host thinking & result injection so the user can see
 * the full coordination process (Cases 10/14/19). */
/** @internal Exported for unit testing only */
export const MAIN_PANEL_KINDS = new Set<GroupMessage['msgKind']>([
  'user_input',
  'host_response',
  'host_thought',
  'host_dispatch',
  'result_injection',
  'system',
  'agent_join',
]);

const LIKELY_DUPLICATE_WINDOW_MS = 30_000;

const isLikelySameLogicalMessage = (a: GroupMessage, b: GroupMessage): boolean => {
  return (
    a.msgKind === b.msgKind &&
    a.senderId === b.senderId &&
    a.senderRole === b.senderRole &&
    a.content === b.content &&
    Math.abs(a.createdAt - b.createdAt) <= LIKELY_DUPLICATE_WINDOW_MS
  );
};

const mergeMessages = (historyMessages: GroupMessage[], liveMessages: GroupMessage[]): GroupMessage[] => {
  const merged = [...historyMessages];

  for (const liveMessage of liveMessages) {
    const sameIdIndex = merged.findIndex((msg) => msg.id === liveMessage.id);
    if (sameIdIndex >= 0) {
      const existing = merged[sameIdIndex];
      const preferLiveContent = liveMessage.content.length >= existing.content.length;
      merged[sameIdIndex] = {
        ...existing,
        ...liveMessage,
        content: preferLiveContent ? liveMessage.content : existing.content,
        streaming: preferLiveContent ? liveMessage.streaming : existing.streaming,
        createdAt: Math.min(existing.createdAt, liveMessage.createdAt),
      };
      continue;
    }

    const duplicateIndex = merged.findIndex((msg) => isLikelySameLogicalMessage(msg, liveMessage));
    if (duplicateIndex >= 0) {
      continue;
    }

    merged.push(liveMessage);
  }

  return merged.sort((a, b) => a.createdAt - b.createdAt);
};

/**
 * Merge consecutive thought messages (host_thought / sub_thinking) from the
 * same sender into a single message so they render as one collapsible block
 * instead of dozens of tiny bubbles.
 */
const collapseThoughts = (msgs: GroupMessage[]): GroupMessage[] => {
  const thoughtKinds = new Set<GroupMessage['msgKind']>(['host_thought', 'sub_thinking']);
  const result: GroupMessage[] = [];

  for (const msg of msgs) {
    const prev = result[result.length - 1];
    if (prev && thoughtKinds.has(msg.msgKind) && prev.msgKind === msg.msgKind && prev.senderId === msg.senderId) {
      // Merge into previous
      result[result.length - 1] = {
        ...prev,
        content: prev.content + msg.content,
        streaming: msg.streaming,
      };
    } else {
      result.push({ ...msg });
    }
  }

  return result;
};

// ── Status badge ──────────────────────────────────────────────────────────────

const RoomStatusDot: React.FC<{ status: GroupRoomInfo['status'] }> = ({ status }) => {
  const colorMap: Record<GroupRoomInfo['status'], string> = {
    idle: 'bg-color-text-3',
    running: 'bg-color-success',
    paused: 'bg-color-warning',
    finished: 'bg-color-text-4',
    error: 'bg-color-danger',
  };
  return (
    <span
      className={`inline-block size-8px rd-full flex-shrink-0 ${colorMap[status]}`}
      style={{
        backgroundColor:
          status === 'running'
            ? 'rgb(var(--success-6))'
            : status === 'paused'
              ? 'rgb(var(--warning-6))'
              : 'var(--color-text-4)',
      }}
    />
  );
};

// ── Inner page ────────────────────────────────────────────────────────────────

const GroupRoomInnerPage: React.FC = () => {
  const { t } = useTranslation('conversation');
  const { roomId } = useParams<{ roomId: string }>();
  const { room, messages, members, isRunning, inputLocked } = useGroupRoom();
  const { setRoom, setRoomStatus, setMembers, setMessages, addMessage, upsertMessage, setMembersFn, setRunning } =
    useGroupRoomActions();

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const latestMessagesRef = useRef<GroupMessage[]>([]);
  const [activeTab, setActiveTab] = useState<string>(MAIN_TAB_KEY);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  // ── Derived: filtered message lists ────────────────────────────────────────

  const mainMessages = collapseThoughts(messages.filter((m) => MAIN_PANEL_KINDS.has(m.msgKind)));

  const getMemberMessages = (member: GroupMember): GroupMessage[] => {
    if (member.role === 'host') {
      return messages.filter((m) => m.senderRole === 'host');
    }
    // Include messages sent BY this agent AND dispatches/injections targeting this agent
    return collapseThoughts(messages.filter((m) => m.senderId === member.id || m.targetId === member.id));
  };

  // ── IPC event subscriptions ─────────────────────────────────────────────────

  useEffect(() => {
    if (!roomId) return;

    const unsubStream = ipcBridge.groupRoom.responseStream.on((event) => {
      if (event.roomId !== roomId) return;

      const msg: GroupMessage = {
        id: event.msg_id,
        msgKind: (event.msg_kind as GroupMessage['msgKind']) ?? 'host_response',
        senderId: event.agentId,
        senderName: event.senderName ?? null,
        targetId: event.targetId ?? null,
        targetName: event.targetName ?? null,
        senderRole: event.agentRole,
        content: event.content,
        streaming: event.streaming,
        createdAt: Date.now(),
      };
      upsertMessage(msg);
    });

    const unsubMember = ipcBridge.groupRoom.memberChanged.on((event) => {
      if (event.roomId !== roomId) return;

      if (event.action === 'join') {
        const incoming: GroupMember = {
          id: event.member.id,
          displayName: event.member.displayName,
          agentType: event.member.agentType,
          role: event.member.role,
          status: (event.member.status as GroupMember['status']) ?? 'idle',
          currentTask: event.member.currentTask,
        };
        setMembersFn((prev) => {
          const exists = prev.some((m) => m.id === incoming.id);
          return exists ? prev : [...prev, incoming];
        });
      } else if (event.action === 'leave') {
        setMembersFn((prev) => prev.filter((m) => m.id !== event.member.id));
      } else if (event.action === 'status_update') {
        setMembersFn((prev) =>
          prev.map((m) =>
            m.id === event.member.id
              ? {
                  ...m,
                  status: (event.member.status as GroupMember['status']) ?? m.status,
                  currentTask: event.member.currentTask,
                }
              : m
          )
        );
      }
    });

    const unsubTurn = ipcBridge.groupRoom.turnCompleted.on((event) => {
      if (event.roomId !== roomId) return;
      setRoomStatus(event.status === 'finished' ? 'idle' : 'error');
      setRunning(!event.canSendMessage);
    });

    return () => {
      unsubStream();
      unsubMember();
      unsubTurn();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ── Load room info ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!roomId) return;

    let cancelled = false;

    ipcBridge.groupRoom.get
      .invoke({ roomId })
      .then((res) => {
        if (cancelled || !res.success || !res.data) return;

        const raw = res.data;

        const roomInfo: GroupRoomInfo = {
          id: raw.id,
          name: raw.name,
          description: null,
          status: (raw.status as GroupRoomInfo['status']) ?? 'idle',
        };
        setRoom(roomInfo);
        setRunning(roomInfo.status === 'running');

        const rawMembers = (raw.members ?? []) as Array<{
          id: string;
          displayName: string;
          agentType: string;
          role: 'host' | 'sub';
          status: string;
          currentTask: string | null;
        }>;

        const parsedMembers: GroupMember[] = rawMembers.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          agentType: m.agentType,
          role: m.role,
          status: (m.status as GroupMember['status']) ?? 'idle',
          currentTask: m.currentTask,
        }));

        setMembers(parsedMembers);

        // Load historical messages so refresh restores conversation
        const rawMessages = (raw.messages ?? []) as Array<{
          id: string;
          msgKind: string;
          senderType: string;
          senderId: string | null;
          senderName: string | null;
          targetId: string | null;
          targetName: string | null;
          content: string;
          status: string;
          createdAt: string | number;
        }>;

        if (rawMessages.length > 0) {
          const parsed: GroupMessage[] = rawMessages.map((msg) => {
            // Resolve senderRole via senderId + members lookup.
            // DB stores sender_type as 'user'|'agent', NOT 'host'|'sub'.
            const member = parsedMembers.find((m) => m.id === msg.senderId);
            return {
              id: msg.id,
              msgKind: (msg.msgKind as GroupMessage['msgKind']) ?? 'system',
              senderId: msg.senderId,
              senderName: msg.senderName ?? member?.displayName ?? null,
              targetId: msg.targetId,
              targetName: msg.targetName,
              senderRole: member?.role ?? null,
              content: msg.content,
              streaming: false,
              createdAt: typeof msg.createdAt === 'number' ? msg.createdAt : new Date(msg.createdAt).getTime(),
            };
          });
          const liveMessages = latestMessagesRef.current;
          setMessages(liveMessages.length > 0 ? mergeMessages(parsed, liveMessages) : parsed);
        }
      })
      .catch(() => {
        // silently ignore for now — error handling to be added
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ── Handle send ────────────────────────────────────────────────────────────

  const handleSend = useCallback(
    (input: string) => {
      if (!roomId) return;

      const msg_id = crypto.randomUUID();

      // Optimistic local message
      const optimistic: GroupMessage = {
        id: msg_id,
        msgKind: 'user_input',
        senderId: null,
        senderName: null,
        targetId: null,
        targetName: null,
        senderRole: null,
        content: input,
        streaming: false,
        createdAt: Date.now(),
      };
      addMessage(optimistic);
      setRoomStatus('running');
      setRunning(true);

      ipcBridge.groupRoom.sendMessage.invoke({ roomId, input, msg_id }).catch(() => {
        setRunning(false);
      });
    },
    [roomId, addMessage, setRoomStatus, setRunning]
  );

  // ── Auto-scroll to bottom when main-panel messages grow ───────────────────

  useEffect(() => {
    if (mainMessages.length === 0) return;
    virtuosoRef.current?.scrollToIndex({ index: mainMessages.length - 1, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainMessages.length]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ArcoLayout className='size-full color-black' data-group-room-page='true'>
      {/* Header */}
      <ArcoLayout.Header className='min-h-44px flex items-center justify-between px-16px pt-8px pb-4px gap-16px !bg-1 border-b-1 border-b-solid border-b-border-2 flex-shrink-0'>
        <div className='flex items-center gap-8px min-w-0'>
          {room && (
            <span data-group-room-status={room.status}>
              <RoomStatusDot status={room.status} />
            </span>
          )}
          <span className='text-15px font-600 color-text-1 truncate' data-group-room-title='true'>
            {room?.name ?? t('groupRoom.loading', { defaultValue: '群聊室' })}
          </span>
          {isRunning && (
            <span className='text-12px color-text-3 flex-shrink-0'>
              {t('groupRoom.running', { defaultValue: '运行中…' })}
            </span>
          )}
        </div>
      </ArcoLayout.Header>

      {/* Body */}
      <div className='flex flex-1 overflow-hidden'>
        {/* Main chat area with tabs */}
        <div className='flex flex-col flex-1 min-w-0 overflow-hidden'>
          {/* Tab header only — rendered via Tabs but content is managed below */}
          <Tabs activeTab={activeTab} onChange={setActiveTab} className={styles.groupTabs} data-group-room-tabs='true'>
            <Tabs.TabPane
              key={MAIN_TAB_KEY}
              title={<span data-group-room-tab='main'>{t('groupRoom.tabMain', { defaultValue: '主对话' })}</span>}
            />
            {members
              .filter((m) => m.role !== 'host')
              .map((member) => (
                <Tabs.TabPane
                  key={member.id}
                  title={
                    <span data-group-room-tab='sub' data-group-room-agent-id={member.id}>
                      {member.displayName}
                    </span>
                  }
                />
              ))}
          </Tabs>

          {/* Tab content — managed outside Arco Tabs to avoid internal layout issues */}
          <div className='flex flex-col flex-1 min-h-0 overflow-hidden'>
            {activeTab === MAIN_TAB_KEY ? (
              <>
                <ArcoLayout.Content className='min-h-0 flex-1 overflow-hidden'>
                  {mainMessages.length === 0 ? (
                    <div className='flex h-full items-center justify-center'>
                      <span className='text-13px color-text-3'>
                        {t('groupRoom.messagesEmpty', { defaultValue: '暂无消息' })}
                      </span>
                    </div>
                  ) : (
                    <Virtuoso
                      ref={virtuosoRef}
                      className='h-full'
                      data={mainMessages}
                      initialTopMostItemIndex={mainMessages.length - 1}
                      followOutput='smooth'
                      atBottomThreshold={80}
                      increaseViewportBy={200}
                      itemContent={(_index, msg) => (
                        <div key={msg.id} className='px-16px py-6px'>
                          <GroupMessageItem message={msg} members={members} />
                        </div>
                      )}
                      components={{
                        Header: () => <div className='h-12px' />,
                        Footer: () => <div className='h-12px' />,
                      }}
                    />
                  )}
                </ArcoLayout.Content>
                <GroupRoomSendBox onSend={handleSend} disabled={inputLocked} loading={isRunning} />
              </>
            ) : (
              (() => {
                const member = members.find((m) => m.id === activeTab);
                if (!member) return null;
                return <AgentTabContent messages={getMemberMessages(member)} members={members} />;
              })()
            )}
          </div>
        </div>

        {/* Right sider — member panel */}
        <div
          data-group-room-member-panel='true'
          className='flex-shrink-0 border-l-1 border-l-solid border-l-border-2 overflow-hidden'
          style={{ width: '220px' }}
        >
          <MemberPanel />
        </div>
      </div>
    </ArcoLayout>
  );
};

// ── Page root ─────────────────────────────────────────────────────────────────

const GroupRoomPage: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  return (
    <GroupRoomProvider key={roomId}>
      <GroupRoomInnerPage />
    </GroupRoomProvider>
  );
};

export default GroupRoomPage;
