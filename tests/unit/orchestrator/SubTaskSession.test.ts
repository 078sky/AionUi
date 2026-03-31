import { describe, it, expect, vi } from 'vitest';
import { SubTaskSession } from '../../../src/process/task/orchestrator/SubTaskSession';
import type { AgentManagerFactory } from '../../../src/process/task/orchestrator/SubTaskSession';
import type { IAgentManager } from '../../../src/process/task/IAgentManager';

function makeMockManager(): IAgentManager {
  return {
    type: 'acp' as never,
    status: 'running' as never,
    workspace: '/tmp',
    conversation_id: 'mock-conv',
    sendMessage: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn(),
    getConfirmations: vi.fn().mockReturnValue([]),
    kill: vi.fn(),
  };
}

describe('SubTaskSession', () => {
  const subTask = { id: 'st1', label: 'Test task', prompt: 'Do something', agentType: 'acp' };

  it('calls factory and sendMessage on start', async () => {
    const mockManager = makeMockManager();
    const factory: AgentManagerFactory = vi.fn().mockReturnValue(mockManager);
    const session = new SubTaskSession(subTask, 'conv-1', factory);

    await session.start('Initial prompt');

    expect(factory).toHaveBeenCalledWith('conv-1', '', expect.anything());
    expect(mockManager.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Initial prompt' }));
  });

  it('sends follow-up message on continue (消息续发)', async () => {
    const mockManager = makeMockManager();
    const factory: AgentManagerFactory = vi.fn().mockReturnValue(mockManager);
    const session = new SubTaskSession(subTask, 'conv-2', factory);

    await session.start('First prompt');
    await session.continue('Follow-up question');

    expect(mockManager.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockManager.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'Follow-up question' })
    );
  });

  it('throws if continue called before start', async () => {
    const factory: AgentManagerFactory = vi.fn();
    const session = new SubTaskSession(subTask, 'conv-3', factory);
    await expect(session.continue('text')).rejects.toThrow('not started');
  });

  it('throws if start called twice', async () => {
    const mockManager = makeMockManager();
    const factory: AgentManagerFactory = vi.fn().mockReturnValue(mockManager);
    const session = new SubTaskSession(subTask, 'conv-4', factory);
    await session.start('prompt');
    await expect(session.start('prompt again')).rejects.toThrow('already started');
  });

  it('calls manager.stop() on stop()', async () => {
    const mockManager = makeMockManager();
    const factory: AgentManagerFactory = vi.fn().mockReturnValue(mockManager);
    const session = new SubTaskSession(subTask, 'conv-5', factory);
    await session.start('prompt');
    await session.stop();
    expect(mockManager.stop).toHaveBeenCalled();
  });
});
