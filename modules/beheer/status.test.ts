import { describe, expect, it } from 'vitest';
import { fromSupervisor, levels } from './status';

const now = new Date('2026-10-30T12:00:00Z');
const raw = {
  snapshot: {
    checked_at: '2026-10-30T11:58:00+00:00',
    containers_total: 52,
    containers_not_running: ['bpf-migrate-1'],
    storage_mounts: [{ label: 'root', percent: 34 }, { label: 'media', percent: 88.2 }],
    zfs_pools: { tank: 'ONLINE' },
    smart: { all_passed: true, disks: [{ id: 'nvme0n1', name: 'NVMe Boot SSD', passed: true, temperature_c: 34 }] },
    ha_healthy: true,
    security_events_24h: 1811,
    security_noise_24h: 19470,
    external_ip: '1.2.3.4',
    external_dns_status: 'ok',
    host_dns_status: 'ok',
    failed_checks: []
  },
  pending_actions: 0,
  claude_calls_24h: 2,
  recent_claude_calls: [{ ts: 1793300000, alert_key: 'container_down:x', host: 'haasieos', action_type: 'restart_container', risk: 'low', duration_s: 3.2 }],
  backup: { last_success_age_days: 0.4 },
  restore_drill: { at: '2026-10-30T12:24:38+01:00', ok: true, target: 'postgram', snapshot: '5ef48dd0', detail: '7823 entities' },
  audit_recent: [{ ts: 1793300000, event: 'action_executed', action: 'restart_container', target: 'x', nested: { a: 1 } }]
};

describe('beheer', () => {
  it('neemt alleen de bekende velden over (geen extern IP naar de browser)', () => {
    const st = fromSupervisor(raw);
    expect(st.containers).toEqual({ total: 52, notRunning: ['bpf-migrate-1'] });
    expect(st.smart.disks[0]).toEqual({ name: 'NVMe Boot SSD', passed: true, temperatureC: 34 });
    expect(st.restoreDrill).toMatchObject({ ok: true, snapshot: '5ef48dd0' });
    expect(st.audit[0]).toEqual({ ts: 1793300000, event: 'action_executed', summary: 'action=restart_container · target=x' });
    expect(JSON.stringify(st)).not.toContain('1.2.3.4');
  });

  it('beoordeelt per onderdeel met vaste drempels', () => {
    expect(levels(fromSupervisor(raw), now)).toEqual({
      supervisor: 'ok', containers: 'warn', storage: 'warn', zfs: 'ok', smart: 'ok', backup: 'ok', restore: 'ok', checks: 'ok'
    });
  });

  it('meldt alarm bij een stille Supervisor, gemiste backup, degraded pool of mislukte restore', () => {
    const bad = fromSupervisor({
      ...raw,
      snapshot: { ...raw.snapshot, checked_at: '2026-10-30T11:30:00+00:00', zfs_pools: { tank: 'DEGRADED' } },
      backup: { last_success_age_days: 3 },
      restore_drill: { ...raw.restore_drill, ok: false }
    });
    expect(levels(bad, now)).toMatchObject({ supervisor: 'alert', zfs: 'alert', backup: 'alert', restore: 'alert' });
  });

  it('kan tegen een lege of oude status (zonder backup-blokken)', () => {
    const st = fromSupervisor({});
    expect(st.backup).toBeNull();
    expect(levels(st, now)).toMatchObject({ supervisor: 'unknown', backup: 'unknown', restore: 'unknown', zfs: 'unknown' });
  });
});
