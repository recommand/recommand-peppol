import { describe, expect, it } from 'bun:test';
import { onboardingDiagnostics } from '../data/at/onboarding-diagnostics';

function capture(slowMs = 10) {
  const messages: string[] = [];
  const record = (message: string) => { messages.push(message); };
  return { messages, diagnostic: onboardingDiagnostics({ info: record, warn: record, error: record }, 'test', slowMs) };
}

describe('onboarding diagnostics', () => {
  it('returns the original result without logging its contents and clears the warning', async () => {
    const { diagnostic, messages } = capture();
    const secret = { mandate: 'private-content' };
    expect(await diagnostic.step('filing', async () => secret)).toBe(secret);
    await Bun.sleep(25);
    expect(messages.length).toBe(2);
    expect(messages[0]).toContain('filing started');
    expect(messages[1]).toContain('filing completed');
    expect(messages.join()).not.toContain('private-content');
  });

  it('reports a stalled step without completing, retrying or cancelling it', async () => {
    const { diagnostic, messages } = capture();
    let release!: () => void;
    let calls = 0;
    let completed = false;
    const pending = diagnostic.step('database', () => {
      calls++;
      return new Promise<void>(resolve => { release = resolve; });
    }).then(() => { completed = true; });
    await Bun.sleep(25);
    expect(messages.some(message => message.includes('database still-running'))).toBe(true);
    expect(completed).toBe(false);
    expect(calls).toBe(1);
    release();
    await pending;
    expect(completed).toBe(true);
  });

  it('rethrows the same error without logging its sensitive message', async () => {
    const { diagnostic, messages } = capture();
    const error = new Error('private-response-body');
    await expect(diagnostic.step('request', async () => { throw error; })).rejects.toBe(error);
    await Bun.sleep(25);
    expect(messages.length).toBe(2);
    expect(messages[1]).toContain('request failed');
    expect(messages.join()).not.toContain(error.message);
  });

  it('does not fail processing if the logger throws', async () => {
    const fail = () => { throw new Error('logger unavailable'); };
    const diagnostic = onboardingDiagnostics({ info: fail, warn: fail, error: fail }, 'test', 1);
    expect(await diagnostic.step('slow', async () => { await Bun.sleep(10); return 42; })).toBe(42);
  });
});
