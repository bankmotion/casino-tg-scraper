/**
 * Lightweight in-memory counters used by the /status bot command.
 * Resets to zero on process restart — intentionally not persisted.
 */
class Stats {
  private bootedAt = new Date();
  private lastPromoAt: Date | null = null;
  private lastPromoChannel: string | null = null;
  private openAiCalls = 0;
  private openAiResetAt = startOfUtcDay();

  recordPromo(channelLabel: string): void {
    this.lastPromoAt = new Date();
    this.lastPromoChannel = channelLabel;
  }

  recordOpenAiCall(): void {
    const todayStart = startOfUtcDay();
    if (this.openAiResetAt.getTime() !== todayStart.getTime()) {
      this.openAiCalls = 0;
      this.openAiResetAt = todayStart;
    }
    this.openAiCalls += 1;
  }

  snapshot() {
    return {
      bootedAt: this.bootedAt,
      lastPromoAt: this.lastPromoAt,
      lastPromoChannel: this.lastPromoChannel,
      openAiCallsToday: this.openAiCalls,
    };
  }
}

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export const stats = new Stats();
