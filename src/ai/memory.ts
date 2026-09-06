import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface TaskSnapshot {
  id: string;
  goal: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  lastUpdated: Date;
  context?: string;
  result?: string;
}

export class MemoryManager {
  private conversationHistory: Map<string, Message[]> = new Map();
  private taskMemory: Map<string, TaskSnapshot> = new Map();
  private sessionTimeoutMs = 60 * 60 * 1000; // 1 hour

  // === Session helpers ===

  /**
   * Returns a stable, deterministic session ID for a given mode + project.
   * e.g. "agent_abcd1234" for mode="agent" and the current working directory.
   * Always the same project → always the same session → conversation history accumulates.
   */
  projectSessionId(mode: string, codebasePath?: string): string {
    const root = codebasePath ?? process.cwd();
    const hash = crypto.createHash('sha1').update(root).digest('hex').slice(0, 8);
    return `${mode}_${hash}`;
  }

  /**
   * Returns the most recent non-expired session ID that starts with the given prefix.
   * Falls back to creating a fresh one via projectSessionId.
   */
  resolveSessionId(mode: string, codebasePath?: string): string {
    const prefix = `${mode}_`;
    const candidates = [...this.conversationHistory.keys()].filter(
      (id) => id.startsWith(prefix)
    );
    if (candidates.length > 0) {
      // Return the one with the most recent message
      return candidates.reduce((latest, id) => {
        const msgs = this.conversationHistory.get(id) ?? [];
        const latestMsgs = this.conversationHistory.get(latest) ?? [];
        const last = msgs[msgs.length - 1]?.timestamp ?? 0;
        const latestLast = latestMsgs[latestMsgs.length - 1]?.timestamp ?? 0;
        return last > latestLast ? id : latest;
      });
    }
    return this.projectSessionId(mode, codebasePath);
  }

  // === Conversation Memory ===

  addMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): void {
    if (!this.conversationHistory.has(sessionId)) {
      this.conversationHistory.set(sessionId, []);
    }
    const messages = this.conversationHistory.get(sessionId)!;

    messages.push({
      role,
      content,
      timestamp: Date.now()
    });

    // Cleanup old messages - keep last 100 per session
    if (messages.length > 100) {
      messages.shift();
    }
  }

  getMessages(sessionId: string, count = 10): Message[] {
    const messages = this.conversationHistory.get(sessionId) || [];
    return messages.slice(-count * 2); // Each turn = user + assistant
  }

  getRecentContext(sessionId: string, maxTokens = 8000): string {
    const messages = this.getMessages(sessionId, 50);
    let totalLength = 0;
    const selected: Message[] = [];

    // Build context respecting token limit (rough approximation)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      const msgLength = msg.content.length;
      if (totalLength + msgLength > maxTokens * 3) break; // 3 chars ≈ 1 token
      selected.unshift(msg);
      totalLength += msgLength;
    }

    return selected.map(m => `${m.role}: ${m.content}`).join('\n\n');
  }

  clearSession(sessionId: string): void {
    this.conversationHistory.delete(sessionId);
  }

  // === Task Memory ===

  createTask(goal: string): string {
    const id = `task_${Date.now()}`;
    const now = new Date();

    this.taskMemory.set(id, {
      id,
      goal,
      status: 'pending',
      createdAt: now,
      lastUpdated: now
    });

    return id;
  }

  updateTask(id: string, updates: Partial<TaskSnapshot>): void {
    const task = this.taskMemory.get(id);
    if (task) {
      Object.assign(task, updates, { lastUpdated: new Date() });
    }
  }

  getTask(id: string): TaskSnapshot | undefined {
    return this.taskMemory.get(id);
  }

  completeTask(id: string, result: string): void {
    this.updateTask(id, {
      status: 'completed',
      result,
      lastUpdated: new Date()
    });
  }

  getRecentTasks(count = 10): TaskSnapshot[] {
    const tasks = Array.from(this.taskMemory.values());
    return tasks
      .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())
      .slice(0, count);
  }

  // === Memory Persistence ===

  saveToDisk(filePath = './logs/rifeclaw-memory.json'): void {
    const data = {
      conversations: Object.fromEntries(
        Array.from(this.conversationHistory.entries()).map(([key, msgs]) => [
          key,
          msgs.map(m => ({ ...m }))
        ])
      ),
      tasks: Object.fromEntries(
        Array.from(this.taskMemory.entries()).map(([key, task]) => [
          key,
          { ...task, createdAt: task.createdAt.toISOString(), lastUpdated: task.lastUpdated.toISOString() }
        ])
      ),
      savedAt: new Date().toISOString()
    };

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  loadFromDisk(filePath = './logs/rifeclaw-memory.json'): void {
    try {
      if (!fs.existsSync(filePath)) return;

      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      this.conversationHistory = new Map(
        Object.entries((data.conversations || {}) as Record<string, unknown[]>).map(([key, msgs]) => [
          key,
          (msgs as Array<{ content: string; role: string; timestamp: unknown }>).map((m) => ({
            ...m,
            role: m.role as Message['role'],
            timestamp: new Date(m.timestamp as string).getTime(),
          }))
        ])
      );

      this.taskMemory = new Map(
        Object.entries(data.tasks || {}).map(([key, task]: [string, any]) => [
          key,
          {
            ...task,
            createdAt: new Date(task.createdAt),
            lastUpdated: new Date(task.lastUpdated)
          }
        ])
      );
    } catch (error) {
      console.error('Failed to load memory from disk:', error);
    }
  }
}

// Singleton instance
export const memoryManager = new MemoryManager();