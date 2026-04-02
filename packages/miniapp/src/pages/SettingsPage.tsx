import { useState } from 'react';
import { Settings, Lightbulb, User, RefreshCcw } from 'lucide-react';
import { api, type UserProfile } from '../api';

const REGIONS = ['Global', 'EU', 'EMEA', 'LATAM', 'APAC', 'North America'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function SettingsPage({ telegramUserId, profile }: { telegramUserId: number; profile: UserProfile }) {
  const prefs = profile.preferences as Record<string, unknown>;
  const [remoteOnly, setRemoteOnly] = useState(Boolean(prefs.remoteOnly));
  const [excludedSkills, setExcludedSkills] = useState(
    (prefs.excludedSkills as string[] | undefined)?.join(', ') ?? ''
  );
  const [scheduleHour, setScheduleHour] = useState(profile.scheduleHour);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [insight, setInsight] = useState('');
  const [insightSaved, setInsightSaved] = useState(false);

  async function savePrefs() {
    setSaving(true);
    setSaved(false);
    try {
      const skills = excludedSkills.split(',').map(s => s.trim()).filter(Boolean);
      await api.updatePreferences(telegramUserId, {
        ...prefs,
        remoteOnly,
        excludedSkills: skills.length ? skills : undefined,
      });
      await api.completeOnboarding({ telegramUserId, scheduleHour });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // TODO: show error toast
    } finally {
      setSaving(false);
    }
  }

  async function submitInsight() {
    if (!insight.trim()) return;
    await api.addInsight(telegramUserId, insight.trim());
    setInsight('');
    setInsightSaved(true);
    setTimeout(() => setInsightSaved(false), 2500);
  }

  async function resetOnboarding() {
    if (!confirm('Are you sure you want to restart onboarding? Your preferences will be kept.')) return;
    await api.resetOnboarding(telegramUserId);
    window.location.replace('/');
  }

  return (
    <div className="page fade-up" style={{ overflow: 'auto', gap: 16 }}>
      <h2><Settings size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} /> Settings</h2>

      {/* Search Preferences */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3>Search Preferences</h3>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={remoteOnly}
            onChange={e => setRemoteOnly(e.target.checked)}
          />
          <span>Include remote jobs</span>
        </label>

        <div className="input-group">
          <label>Excluded skills (comma-separated)</label>
          <input
            className="input"
            placeholder="e.g. Python, Java, .NET"
            value={excludedSkills}
            onChange={e => setExcludedSkills(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label>Daily update time (UTC)</label>
          <select
            className="input"
            value={scheduleHour}
            onChange={e => setScheduleHour(Number(e.target.value))}
          >
            {HOURS.map(h => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00 UTC
              </option>
            ))}
          </select>
        </div>

        <button className="btn btn-primary" onClick={savePrefs} disabled={saving}>
          {saving ? '⏳ Saving...' : saved ? '✅ Saved!' : '💾 Save Changes'}
        </button>
      </div>

      {/* Log insight */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <h3><Lightbulb size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Log an Insight</h3>
          <p style={{ marginTop: 4, fontSize: 13 }}>
            Share any update from your job search — rejections, interview feedback, things companies said.
            I'll use this to find better matches.
          </p>
        </div>
        <textarea
          className="input"
          rows={3}
          style={{ resize: 'vertical' }}
          placeholder="e.g. Got rejected from Wix — they said they need more backend experience..."
          value={insight}
          onChange={e => setInsight(e.target.value)}
        />
        <button className="btn btn-secondary" onClick={submitInsight} disabled={!insight.trim()}>
          {insightSaved ? '✅ Noted!' : '📝 Log Insight'}
        </button>
      </div>

      {/* Account info */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3><User size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Account</h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--text-dim)' }}>Plan</span>
          <span className={`badge ${profile.plan === 'pro' ? 'badge-green' : 'badge-purple'}`}>
            {profile.plan === 'pro' ? '⭐ Pro' : 'Free'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--text-dim)' }}>User ID</span>
          <span style={{ fontFamily: 'monospace', color: 'var(--text-dim)' }}>{telegramUserId}</span>
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 12, color: 'var(--red)', borderColor: 'var(--red)' }} onClick={resetOnboarding}>
          <RefreshCcw size={16} /> Restart Onboarding
        </button>
      </div>
    </div>
  );
}
