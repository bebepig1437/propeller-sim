import { describe, it, expect } from 'vitest';
import { getDebugHudChannels } from '../src/ui/hud';

describe('Phase 6b debug diagnostic path', () => {
  it('emits ledger Q_net and integrator applied torque side by side with finite values', () => {
    const channels = getDebugHudChannels();
    const ids = channels.map(c => c.id);
    expect(ids).toContain('ledger.qNet');
    expect(ids).toContain('integrator.appliedTorque');
    for (const c of channels) {
      expect(Number.isFinite(c.read())).toBe(true);
    }
  });
});
