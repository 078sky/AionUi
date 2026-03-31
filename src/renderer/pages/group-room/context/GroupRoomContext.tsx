/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useContext, useMemo, useReducer } from 'react';
import type { GroupMember, GroupMessage, GroupRoomInfo } from '../types';

// ── State ────────────────────────────────────────────────────────────────────

export type GroupRoomState = {
  room: GroupRoomInfo | null;
  members: GroupMember[];
  messages: GroupMessage[];
  isRunning: boolean;
  inputLocked: boolean;
};

// ── Actions ───────────────────────────────────────────────────────────────────

export type GroupRoomActions = {
  addMessage: (msg: GroupMessage) => void;
  upsertMessage: (msg: GroupMessage) => void;
  setMessages: (msgs: GroupMessage[]) => void;
  setMembersFn: (updater: (prev: GroupMember[]) => GroupMember[]) => void;
  setMembers: (members: GroupMember[]) => void;
  setRoom: (room: GroupRoomInfo) => void;
  setRoomStatus: (status: GroupRoomInfo['status']) => void;
  setRunning: (v: boolean) => void;
  setInputLocked: (v: boolean) => void;
};

// ── Reducer ───────────────────────────────────────────────────────────────────

/** @internal Exported for unit testing only */
export type Action =
  | { type: 'ADD_MESSAGE'; payload: GroupMessage }
  | { type: 'UPSERT_MESSAGE'; payload: GroupMessage }
  | { type: 'SET_MESSAGES'; payload: GroupMessage[] }
  | { type: 'SET_MEMBERS'; payload: GroupMember[] }
  | { type: 'SET_MEMBERS_FN'; payload: (prev: GroupMember[]) => GroupMember[] }
  | { type: 'SET_ROOM'; payload: GroupRoomInfo }
  | { type: 'SET_ROOM_STATUS'; payload: GroupRoomInfo['status'] }
  | { type: 'SET_RUNNING'; payload: boolean }
  | { type: 'SET_INPUT_LOCKED'; payload: boolean };

/** @internal Exported for unit testing only */
export const initialState: GroupRoomState = {
  room: null,
  members: [],
  messages: [],
  isRunning: false,
  inputLocked: false,
};

/** @internal Exported for unit testing only */
export function reducer(state: GroupRoomState, action: Action): GroupRoomState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'UPSERT_MESSAGE': {
      const existing = state.messages.find((m) => m.id === action.payload.id);
      if (existing) {
        return {
          ...state,
          messages: state.messages.map((m) =>
            m.id === action.payload.id
              ? {
                  ...m,
                  content: action.payload.streaming
                    ? (m.content ?? '') + action.payload.content
                    : action.payload.content !== ''
                      ? action.payload.content
                      : m.content,
                  streaming: action.payload.streaming,
                }
              : m
          ),
        };
      }
      return { ...state, messages: [...state.messages, action.payload] };
    }
    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };
    case 'SET_MEMBERS':
      return { ...state, members: action.payload };
    case 'SET_MEMBERS_FN':
      return { ...state, members: action.payload(state.members) };
    case 'SET_ROOM':
      return { ...state, room: action.payload };
    case 'SET_ROOM_STATUS':
      return state.room ? { ...state, room: { ...state.room, status: action.payload } } : state;
    case 'SET_RUNNING':
      return { ...state, isRunning: action.payload, inputLocked: action.payload };
    case 'SET_INPUT_LOCKED':
      return { ...state, inputLocked: action.payload };
    default:
      return state;
  }
}

// ── Contexts ──────────────────────────────────────────────────────────────────

const GroupRoomStateContext = React.createContext<GroupRoomState>(initialState);
const GroupRoomActionsContext = React.createContext<GroupRoomActions | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export const GroupRoomProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const actions = useMemo<GroupRoomActions>(
    () => ({
      addMessage: (msg) => dispatch({ type: 'ADD_MESSAGE', payload: msg }),
      upsertMessage: (msg) => dispatch({ type: 'UPSERT_MESSAGE', payload: msg }),
      setMessages: (msgs) => dispatch({ type: 'SET_MESSAGES', payload: msgs }),
      setMembersFn: (updater) => dispatch({ type: 'SET_MEMBERS_FN', payload: updater }),
      setMembers: (members) => dispatch({ type: 'SET_MEMBERS', payload: members }),
      setRoom: (room) => dispatch({ type: 'SET_ROOM', payload: room }),
      setRoomStatus: (status) => dispatch({ type: 'SET_ROOM_STATUS', payload: status }),
      setRunning: (v) => dispatch({ type: 'SET_RUNNING', payload: v }),
      setInputLocked: (v) => dispatch({ type: 'SET_INPUT_LOCKED', payload: v }),
    }),
    []
  );

  return (
    <GroupRoomStateContext.Provider value={state}>
      <GroupRoomActionsContext.Provider value={actions}>{children}</GroupRoomActionsContext.Provider>
    </GroupRoomStateContext.Provider>
  );
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** Read group room state */
export const useGroupRoom = (): GroupRoomState => useContext(GroupRoomStateContext);

/** Get group room action dispatchers */
export const useGroupRoomActions = (): GroupRoomActions => {
  const ctx = useContext(GroupRoomActionsContext);
  if (!ctx) throw new Error('useGroupRoomActions must be used inside GroupRoomProvider');
  return ctx;
};

/**
 * @deprecated Use useGroupRoom() instead.
 * Kept for backwards-compat while pages are migrated.
 */
export const useGroupRoomContext = useGroupRoom;

/**
 * @deprecated Use useGroupRoomActions() instead.
 */
export const useUpdateGroupRoom = (): GroupRoomActions => {
  const ctx = useContext(GroupRoomActionsContext);
  if (!ctx) throw new Error('useUpdateGroupRoom must be used inside GroupRoomProvider');
  return ctx;
};

// Convenience re-export so callers can do: const { addMessage } = useGroupRoomActions()
export const useGroupRoomCallback = <K extends keyof GroupRoomActions>(key: K): GroupRoomActions[K] => {
  const actions = useGroupRoomActions();
  return useCallback(
    (...args: Parameters<GroupRoomActions[K]>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actions[key] as (...a: any[]) => any)(...args);
    },
    [actions, key]
  ) as GroupRoomActions[K];
};
