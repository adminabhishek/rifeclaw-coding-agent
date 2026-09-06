import fs from 'node:fs';
import path from 'node:path';
import { optionalEnv } from '../../env';

export class ApiUsageTracker {
  private dailyUsage: { [dateKey: string]: number } = {};
  private dailyLimits = new Map<string, number>();
  private history: { date: string; usage: number; timestamp: number }[] = [];
  private limitedCalls = 0;

  constructor(
    private defaultLimit = 1000,
    private telegraphEnabled = false
  ) {}

  initFromEnv(): void {
    const openRouterDailyLimit = optionalEnv('OPENROUTER_DAILY_LIMIT');
    if (openRouterDailyLimit !== undefined) {
      const limit = parseInt(openRouterDailyLimit, 10);
      if (!isNaN(limit) && limit > 0) {
        this.defaultLimit = limit;
      }
    }

    const telegramBotToken = optionalEnv('TELEGRAM_BOT_TOKEN');
    const telegramOwnerId = optionalEnv('TELEGRAM_OWNER_ID');
    if (telegramBotToken !== undefined && telegramOwnerId !== undefined) {
      this.telegraphEnabled = true;
    }

    this.loadHistory();
  }

  private getDateKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  incrementUsage(): void {
    const date = this.getDateKey();
    this.dailyUsage[date] = (this.dailyUsage[date] || 0) + 1;
    this.history.push({ date, usage: this.dailyUsage[date], timestamp: Date.now() });
    this.checkLimits(date);
    this.storeUsage();
  }

  incrementLimitedCall(): void {
    this.limitedCalls++;
  }

  getCurrentUsage(): number {
    return this.dailyUsage[this.getDateKey()] || 0;
  }

  getUsageHistory(): { date: string; usage: number }[] {
    return this.history.map(h => ({ date: h.date, usage: h.usage }));
  }

  getLimitedCalls(): number {
    return this.limitedCalls;
  }

  private checkLimits(date: string): void {
    const usage = this.dailyUsage[date] || 0;
    const remaining = this.defaultLimit - usage;

    const thresholds = {
      warning: Math.floor(this.defaultLimit * 0.8),
      critical: Math.floor(this.defaultLimit * 0.95)
    };

    if (usage >= thresholds.critical) {
      this.sendAlert(`🔴 **Critical Alert**: ${usage}/${this.defaultLimit} (${date}) - Only ${remaining} calls remaining`);
    } else if (usage >= thresholds.warning) {
      this.sendAlert(`⚠️ **Warning**: ${usage}/${this.defaultLimit} (${date}) - ${remaining} calls remaining`);
    }

    if (this.dailyLimits.has(date)) {
      const storedLimit = this.dailyLimits.get(date)!;
      if (usage >= storedLimit) {
        this.sendAlert(`🚨 **Hard Limit Exceeded**: ${usage}/${storedLimit} (${date})`);
      }
    }
  }

  private sendAlert(message: string): void {
    console.log(`[API Monitor] ${message}`);

    if (this.telegraphEnabled) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const ownerId = process.env.TELEGRAM_OWNER_ID;

      if (token && ownerId) {
        fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: ownerId,
            text: `[RifeClaw] ${message}`,
            parse_mode: 'Markdown'
          })
        }).catch(err => {
          console.error('Failed to send Telegram alert:', err);
        });
      }
    }
  }

  private loadHistory(): void {
    const logsDir = path.resolve(process.cwd(), 'logs');
    const filePath = path.join(logsDir, 'api-usage.json');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        this.history = data.history || [];
        this.dailyUsage = data.dailyUsage || {};
        this.dailyLimits = new Map(Object.entries(data.dailyLimits || {}));
        this.limitedCalls = data.limitedCalls || 0;
      } catch (err) {
        console.error('Failed to load API usage history:', err);
      }
    }
  }

  private storeUsage(): void {
    const logsDir = path.resolve(process.cwd(), 'logs');
    const filePath = path.join(logsDir, 'api-usage.json');

    const data = {
      history: this.history.slice(-1000), // Keep last 1000 entries
      dailyUsage: this.dailyUsage,
      dailyLimits: Object.fromEntries(this.dailyLimits),
      limitedCalls: this.limitedCalls,
      lastUpdated: new Date().toISOString()
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Failed to store API usage:', err);
    }
  }

  setDailyLimit(date: string, limit: number): void {
    this.dailyLimits.set(date, limit);
    this.storeUsage();
  }

  getStats(): {
    currentUsage: number;
    dailyLimit: number;
    remaining: number;
    totalCalls: number;
    limitedCalls: number;
  } {
    const currentUsage = this.getCurrentUsage();
    const totalCalls = Object.values(this.dailyUsage).reduce((sum, v) => sum + v, 0);

    return {
      currentUsage,
      dailyLimit: this.defaultLimit,
      remaining: Math.max(0, this.defaultLimit - currentUsage),
      totalCalls,
      limitedCalls: this.limitedCalls
    };
  }
}

// Singleton instance
export const apiUsageTracker = new ApiUsageTracker();