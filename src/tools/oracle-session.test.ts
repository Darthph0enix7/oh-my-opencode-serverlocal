import { afterEach, describe, expect, mock, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createOracleSessionTool } from './oracle-session';

/**
 * Fake opencode client with a session registry keyed by session id.
 * oracle_session only uses: session.messages (parent), session.create,
 * session.update (title), session.prompt (oracle), session.delete.
 */
function createFakeClient() {
  const sessions = new Map<string, { id: string; messages: unknown[] }>();
  const deleted = new Set<string>();
  let nextId = 0;

  const makeSession = (): string => {
    const id = `ses_fake${nextId++}`;
    sessions.set(id, { id, messages: [] });
    return id;
  };

  const client = {
    session: {
      messages: mock(async ({ path: { id } }: { path: { id: string } }) => {
        const s = sessions.get(id);
        if (!s) return { error: { message: 'session not found' } };
        return { data: s.messages };
      }),
      create: mock(async () => {
        const id = makeSession();
        return { data: { id } };
      }),
      update: mock(async () => ({ data: {} })),
      prompt: mock(
        async ({
          path: { id },
          body,
        }: {
          path: { id: string };
          body: { parts: Array<{ type: string; text?: string }> };
        }) => {
          const s = sessions.get(id);
          if (!s) return { error: { message: 'oracle session not found' } };
          s.messages.push({ info: { role: 'user' }, parts: body.parts });
          return {
            data: {
              info: { id: `msg_${id}` },
              parts: [
                {
                  type: 'text',
                  text: `oracle response to: ${body.parts[0]?.text ?? ''}`,
                },
              ],
            },
          };
        },
      ),
      delete: mock(async ({ path: { id } }: { path: { id: string } }) => {
        deleted.add(id);
        sessions.delete(id);
        return { data: {} };
      }),
    },
  };

  /** Push a user message onto a parent session (simulates a new query). */
  const addUserMessage = (sessionId: string, text: string): string => {
    const s = sessions.get(sessionId);
    const msg = { info: { id: `msg_u_${Date.now()}_${Math.random()}`, role: 'user' }, parts: [{ type: 'text', text }] };
    s?.messages.push(msg);
    return msg.info.id;
  };

  return { client, sessions, deleted, makeSession, addUserMessage };
}

const tmpDirs: string[] = [];

function makeRegistryPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-reg-'));
  tmpDirs.push(dir);
  return path.join(dir, 'oracle-sessions.json');
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function createTool(client: unknown, registryPath: string) {
  return createOracleSessionTool({
    client: client as never,
    registryPath,
  });
}

describe('oracle_session persistence', () => {
  test('creates a session on first call and persists it to the registry', async () => {
    const { client, makeSession, addUserMessage } = createFakeClient();
    const parent = makeSession();
    const regPath = makeRegistryPath();
    const tool = createTool(client, regPath);

    addUserMessage(parent, 'query 1');
    const res = await tool.tool.execute(
      { prompt: 'review the plan' },
      { sessionID: parent } as never,
    );

    const parsed = JSON.parse(res as string);
    expect(parsed.session_id).toBeDefined();
    expect(parsed.prompts).toBe(1);

    // Registry file exists and maps parent → session.
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    expect(reg[parent].sessionId).toBe(parsed.session_id);
    expect(reg[parent].lastUserMsgId).toBeTruthy();
  });

  test('reuses the same session for a second call in the same query', async () => {
    const { client, makeSession, addUserMessage } = createFakeClient();
    const parent = makeSession();
    const regPath = makeRegistryPath();
    const tool = createTool(client, regPath);

    addUserMessage(parent, 'query 1');
    const r1 = JSON.parse(
      (await tool.tool.execute({ prompt: 'first' }, { sessionID: parent } as never)) as string,
    );
    const r2 = JSON.parse(
      (await tool.tool.execute({ prompt: 'second' }, { sessionID: parent } as never)) as string,
    );

    expect(r2.session_id).toBe(r1.session_id);
    expect(r2.prompts).toBe(2);
  });

  test('new user query deletes the old session and creates a fresh one', async () => {
    const { client, makeSession, addUserMessage, deleted } = createFakeClient();
    const parent = makeSession();
    const regPath = makeRegistryPath();
    const tool = createTool(client, regPath);

    addUserMessage(parent, 'query 1');
    const r1 = JSON.parse(
      (await tool.tool.execute({ prompt: 'first' }, { sessionID: parent } as never)) as string,
    );

    // New query: the parent gets a NEW user message.
    addUserMessage(parent, 'query 2');
    const r2 = JSON.parse(
      (await tool.tool.execute({ prompt: 'second' }, { sessionID: parent } as never)) as string,
    );

    expect(r2.session_id).not.toBe(r1.session_id);
    // Old session was deleted.
    expect(deleted.has(r1.session_id)).toBe(true);
  });

  test('RESTART: new tool instance with same registry deletes the orphan on a new query', async () => {
    const { client, makeSession, addUserMessage, deleted } = createFakeClient();
    const parent = makeSession();
    const regPath = makeRegistryPath();

    // Process A: creates an oracle session for this parent.
    const toolA = createTool(client, regPath);
    addUserMessage(parent, 'query 1');
    const r1 = JSON.parse(
      (await toolA.tool.execute({ prompt: 'first' }, { sessionID: parent } as never)) as string,
    );

    // Process B: fresh tool instance (in-memory state lost) — simulates a
    // server restart. Same registry file on disk.
    const toolB = createTool(client, regPath);

    // New query in the parent.
    addUserMessage(parent, 'query 2');
    const r2 = JSON.parse(
      (await toolB.tool.execute({ prompt: 'second' }, { sessionID: parent } as never)) as string,
    );

    // A fresh session was created AND the orphan from process A was deleted.
    expect(r2.session_id).not.toBe(r1.session_id);
    expect(deleted.has(r1.session_id)).toBe(true);
  });

  test('RESTART: same query continues the persisted session (no new create)', async () => {
    const { client, makeSession, addUserMessage, deleted } = createFakeClient();
    const parent = makeSession();
    const regPath = makeRegistryPath();

    const toolA = createTool(client, regPath);
    addUserMessage(parent, 'query 1');
    const r1 = JSON.parse(
      (await toolA.tool.execute({ prompt: 'first' }, { sessionID: parent } as never)) as string,
    );

    // Process B (restart) — SAME last user message (same query continues).
    const toolB = createTool(client, regPath);
    const r2 = JSON.parse(
      (await toolB.tool.execute({ prompt: 'second' }, { sessionID: parent } as never)) as string,
    );

    // Same session reused across restart, nothing deleted.
    expect(r2.session_id).toBe(r1.session_id);
    expect(deleted.size).toBe(0);
  });

  test('explicit session_id from a previous query is rejected after restart', async () => {
    const { client, makeSession, addUserMessage, deleted } = createFakeClient();
    const parent = makeSession();
    const regPath = makeRegistryPath();

    const toolA = createTool(client, regPath);
    addUserMessage(parent, 'query 1');
    const r1 = JSON.parse(
      (await toolA.tool.execute({ prompt: 'first' }, { sessionID: parent } as never)) as string,
    );

    // Process B (restart), NEW query, orchestrator passes the stale id.
    const toolB = createTool(client, regPath);
    addUserMessage(parent, 'query 2');
    const r2 = JSON.parse(
      (await toolB.tool.execute(
        { prompt: 'second', session_id: r1.session_id },
        { sessionID: parent } as never,
      )) as string,
    );

    // Stale id rejected → fresh session; orphan deleted.
    expect(r2.session_id).not.toBe(r1.session_id);
    expect(deleted.has(r1.session_id)).toBe(true);
  });
});
