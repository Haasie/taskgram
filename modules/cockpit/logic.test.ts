import { describe, expect, it } from 'vitest';
import { levelOf, riskCounts, toCockpit } from './logic';

const ws = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  machine: 'laptop',
  connect_target: 'laptop',
  path: '/home/dev/code/demo',
  repo_remote: 'github.com/example/demo',
  branch: 'feat/demo',
  feature_id: 'f1',
  last_activity_at: '2026-11-02T10:00:00Z',
  git: { dirty_count: 0, unpushed_count: 2, has_upstream: true },
  git_state_at: '2026-11-02T10:00:00Z',
  missing_since: null,
  risks: ['unpushed'],
  resume_session: null,
  sessions: [],
  ...over
});

const where = {
  view: 'stage',
  generated_at: '2026-11-02T12:00:00Z',
  dormant_after_days: 30,
  groups: [
    {
      key: 'building',
      label: 'Building',
      features: [
        {
          id: 'f1',
          title: 'demo',
          stage: 'building',
          stage_source: 'manual',
          stage_set_at: '2026-11-01T00:00:00Z',
          task_status: 'inbox',
          pull_requests: [
            { url: 'https://github.com/example/demo/pull/1', state: 'open', updated_at: '2026-11-02T00:00:00Z' },
            { url: 'javascript:alert(1)', state: 'open', updated_at: '2026-11-02T00:00:00Z' }
          ],
          workspaces: [
            ws({
              resume_session: {
                id: 's1',
                agent_kind: 'claude-code',
                agent_session_id: "abc'123",
                status: 'idle',
                cwd: '/home/dev/code/demo',
                transcript_path: '/home/dev/.claude/projects/x.jsonl',
                last_activity_at: '2026-11-02T10:00:00Z'
              }
            })
          ]
        }
      ]
    },
    { key: 'review', label: 'Review', features: [] },
    { key: 'unassigned', label: 'Unassigned', workspaces: [ws({ id: 'w2', feature_id: null, risks: ['missing'], missing_since: '2026-11-01T00:00:00Z' })] }
  ]
};

describe('cockpit: /api/where omzetten', () => {
  it('houdt fasen en volgorde aan en zet werkplekken zonder feature apart', () => {
    const c = toCockpit(where);
    expect(c.groups.map((g) => g.key)).toEqual(['building', 'review']);
    expect(c.groups[0]!.features[0]!.workspaces[0]!).toMatchObject({ machine: 'laptop', branch: 'feat/demo', unpushed: 2, level: 'warn' });
    expect(c.unassigned).toHaveLength(1);
    expect(c.unassigned[0]!.level).toBe('alert');
  });

  it('geeft alleen https-PR-links door en geen transcript-paden', () => {
    const c = toCockpit(where);
    expect(c.groups[0]!.features[0]!.pullRequests).toEqual([{ url: 'https://github.com/example/demo/pull/1', state: 'open' }]);
    expect(JSON.stringify(c)).not.toContain('.jsonl');
  });

  it('maakt een veilig gequote hervat-commando voor Claude Code', () => {
    const resume = toCockpit(where).groups[0]!.features[0]!.workspaces[0]!.resume;
    expect(resume).toBe(`cd '/home/dev/code/demo' && claude --resume 'abc'\\''123'`);
  });

  it('weegt risico’s: ontbrekend of afgebroken is alarm, lokaal werk is let op', () => {
    expect(levelOf([])).toBe('ok');
    expect(levelOf(['dirty', 'unpushed'])).toBe('warn');
    expect(levelOf(['unpushed', 'missing'])).toBe('alert');
    expect(levelOf(['interrupted'])).toBe('alert');
  });

  it('telt risico’s over alle werkplekken en overleeft rommelige invoer', () => {
    expect(riskCounts(toCockpit(where))).toMatchObject({ unpushed: 1, missing: 1, dirty: 0 });
    expect(toCockpit(null)).toEqual({ generatedAt: null, groups: [], unassigned: [] });
    expect(toCockpit({ groups: [{ key: 'building', features: [{ workspaces: [{ risks: ['bogus'] }] }] }] }).groups[0]!.features[0]!.workspaces[0]!.risks).toEqual([]);
  });
});
