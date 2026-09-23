import { describe, it, expect } from 'vitest';
import { getDebugHudChannels } from '../src/ui/hud';

describe('Debug HUD channels emit finite values', () => {
  it('ledger and integrator channels are finite after one step', () => {
    const channels = getDebugHudChannels();
    const ids = channels.map(c => c.id);
    expect(ids).toContain('ledger.qNet');
    expect(ids).toContain('integrator.appliedTorque');
    for (const c of channels) expect(Number.isFinite(c.read())).toBe(true);
  });
});
