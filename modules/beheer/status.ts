/**
 * Beheer: wat de Homelab Supervisor (haasiehomeops) over de omgeving weet, in een vaste vorm.
 * De server zet /api/status van de Supervisor om met `fromSupervisor`; alleen deze velden gaan naar de browser.
 */

export type Level = 'ok' | 'warn' | 'alert' | 'unknown';

export type BeheerStatus = {
  checkedAt: string | null;
  containers: { total: number | null; notRunning: string[] };
  storage: { label: string; percent: number | null }[];
  zfs: Record<string, string>;
  smart: { allPassed: boolean | null; disks: { name: string; passed: boolean | null; temperatureC: number | null }[] };
  homeAssistant: boolean | null;
  security: { events24h: number | null; noise24h: number | null };
  dns: { external: string | null; host: string | null };
  failedChecks: string[];
  backup: { lastSuccessAgeDays: number | null } | null;
  restoreDrill: { at: string | null; ok: boolean; target: string | null; snapshot: string | null; detail: string | null } | null;
  claude: { calls24h: number | null; pendingActions: number | null; recent: ClaudeCall[] };
  audit: AuditEntry[];
};

export type ClaudeCall = { ts: number; alertKey: string; host: string | null; action: string; risk: string; durationS: number | null };
export type AuditEntry = { ts: number; event: string; summary: string };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);

/** Korte, leesbare samenvatting van een audit-regel: event plus de belangrijkste velden. */
function auditSummary(e: Record<string, unknown>): string {
  return Object.entries(e)
    .filter(([k, v]) => k !== 'ts' && k !== 'event' && v !== null && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
    .join(' · ');
}

export function fromSupervisor(raw: unknown): BeheerStatus {
  const s = obj(raw);
  const snap = obj(s.snapshot);
  const smart = obj(snap.smart);
  const backup = s.backup === undefined ? null : { lastSuccessAgeDays: num(obj(s.backup).last_success_age_days) };
  const drill = s.restore_drill ? obj(s.restore_drill) : null;
  return {
    checkedAt: str(snap.checked_at),
    containers: { total: num(snap.containers_total), notRunning: arr(snap.containers_not_running).filter((c): c is string => typeof c === 'string') },
    storage: arr(snap.storage_mounts).map((m) => ({ label: str(obj(m).label) ?? '?', percent: num(obj(m).percent) })),
    zfs: Object.fromEntries(Object.entries(obj(snap.zfs_pools)).map(([k, v]) => [k, String(v)])),
    smart: {
      allPassed: bool(smart.all_passed),
      disks: arr(smart.disks).map((d) => ({ name: str(obj(d).name) ?? str(obj(d).id) ?? '?', passed: bool(obj(d).passed), temperatureC: num(obj(d).temperature_c) }))
    },
    homeAssistant: bool(snap.ha_healthy),
    security: { events24h: num(snap.security_events_24h), noise24h: num(snap.security_noise_24h) },
    dns: { external: str(snap.external_dns_status), host: str(snap.host_dns_status) },
    failedChecks: arr(snap.failed_checks).map((c) => (typeof c === 'string' ? c : str(obj(c).name) ?? JSON.stringify(c))),
    backup,
    restoreDrill: drill
      ? { at: str(drill.at), ok: drill.ok === true, target: str(drill.target), snapshot: str(drill.snapshot), detail: str(drill.detail) }
      : null,
    claude: {
      calls24h: num(s.claude_calls_24h),
      pendingActions: num(s.pending_actions),
      recent: arr(s.recent_claude_calls).map((c) => {
        const o = obj(c);
        return { ts: num(o.ts) ?? 0, alertKey: str(o.alert_key) ?? '?', host: str(o.host), action: str(o.action_type) ?? '?', risk: str(o.risk) ?? '?', durationS: num(o.duration_s) };
      })
    },
    audit: arr(s.audit_recent).map((e) => ({ ts: num(obj(e).ts) ?? 0, event: str(obj(e).event) ?? '?', summary: auditSummary(obj(e)) }))
  };
}

/** Beoordeling per onderdeel; drempels sluiten aan op de Supervisor (backup >2 dagen = gemist). */
export function levels(st: BeheerStatus, now: Date) {
  const ageMin = st.checkedAt ? (now.getTime() - Date.parse(st.checkedAt)) / 60_000 : null;
  const maxPct = Math.max(-1, ...st.storage.map((m) => m.percent ?? -1));
  const drillAgeDays = st.restoreDrill?.at ? (now.getTime() - Date.parse(st.restoreDrill.at)) / 86_400_000 : null;
  const backupAge = st.backup?.lastSuccessAgeDays ?? null;
  return {
    // Stilte is dubbelzinnig: een Supervisor die >15 min niet meer gepolld heeft, telt als alarm.
    supervisor: (ageMin === null ? 'unknown' : ageMin > 15 ? 'alert' : ageMin > 10 ? 'warn' : 'ok') as Level,
    containers: (st.containers.total === null ? 'unknown' : st.containers.notRunning.length ? 'warn' : 'ok') as Level,
    storage: (maxPct < 0 ? 'unknown' : maxPct >= 95 ? 'alert' : maxPct >= 85 ? 'warn' : 'ok') as Level,
    zfs: (!Object.keys(st.zfs).length ? 'unknown' : Object.values(st.zfs).every((v) => v === 'ONLINE') ? 'ok' : 'alert') as Level,
    smart: (st.smart.allPassed === null ? 'unknown' : st.smart.allPassed ? 'ok' : 'alert') as Level,
    backup: (backupAge === null ? 'unknown' : backupAge > 2 ? 'alert' : backupAge > 1.25 ? 'warn' : 'ok') as Level,
    restore: (!st.restoreDrill ? 'unknown' : !st.restoreDrill.ok ? 'alert' : drillAgeDays !== null && drillAgeDays > 45 ? 'warn' : 'ok') as Level,
    checks: (st.failedChecks.length ? 'warn' : 'ok') as Level
  };
}

export const LEVEL_WORD: Record<Level, string> = { ok: 'OK', warn: 'LET OP', alert: 'ALARM', unknown: 'ONBEKEND' };
export const LEVEL_MARK: Record<Level, string> = { ok: '●', warn: '▲', alert: '■', unknown: '○' };
