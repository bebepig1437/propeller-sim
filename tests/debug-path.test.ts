import { describe, it, expect } from 'vitest';
import { getDebugHudChannels } from '../src/ui/hud';

describe('Phase 6b debug diagnostic path', () => {
  it('emits ledger Q_net and integrator applied torque side by side', () => {
    const channels = getDebugHudChannels();
    expect(channels).toContain('ledger.qNet');
    expect(channels).toContain('integrator.appliedTorque');
  });
});
