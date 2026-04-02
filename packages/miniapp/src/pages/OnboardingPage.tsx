import { useState } from 'react';
import { api } from '../api';
import { FileText, MapPin, Clock, CheckCircle } from 'lucide-react';

const REGIONS = ['Global', 'EU', 'EMEA', 'LATAM', 'APAC', 'North America'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type Step = 'cv' | 'schedule' | 'done';

export function OnboardingPage({ telegramUserId }: { telegramUserId: number }) {
  const [step, setStep] = useState<Step>('cv');
  const [cvUrl, setCvUrl] = useState('');
  const [scheduleHour, setScheduleHour] = useState(9);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const steps: Step[] = ['cv', 'schedule'];
  const stepIdx = steps.indexOf(step);

  function toggleRegion(r: string, list: string[], setList: (v: string[]) => void) {
    setList(list.includes(r) ? list.filter(x => x !== r) : [...list, r]);
  }

  async function finish() {
    setLoading(true);
    setError('');
    try {
      await api.completeOnboarding({
        telegramUserId,
        cvUrl: cvUrl || undefined,
        scheduleHour,
        region: 'global', // fallback, agent should extract from CV
      });
      setStep('done');
      // Reload so App picks up onboarded=true
      setTimeout(() => window.location.replace('/'), 1200);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'done') {
    return (
      <div className="page fade-up">
        <div className="empty-state">
          <div className="empty-icon"><CheckCircle size={48} color="var(--primary)" /></div>
          <h2>You're all set!</h2>
          <p>Your first job search is starting now. I'll notify you when results are ready.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page fade-up">
      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <h1>Swipe To Hire</h1>
        <p style={{ marginTop: 4 }}>Let's set up your profile</p>
      </div>

      {/* Stepper */}
      <div className="stepper">
        {steps.map((s, i) => (
          <div
            key={s}
            className={`step-dot ${s === step ? 'active' : i < stepIdx ? 'done' : ''}`}
          />
        ))}
      </div>

      {/* Step: CV */}
      {step === 'cv' && (
        <div className="card fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 12 }}>
              <FileText size={48} color="var(--primary)" />
            </div>
            <h2>Your CV</h2>
            <p style={{ marginTop: 4 }}>Paste a link to your CV or LinkedIn profile</p>
          </div>
          <div className="input-group">
            <label>CV file URL</label>
            <input
              className="input"
              placeholder="https://drive.google.com/... or linkedin.com/in/..."
              value={cvUrl}
              onChange={e => setCvUrl(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setStep('schedule')}
            disabled={!cvUrl.trim()}
          >
            Continue →
          </button>
        </div>
      )}

      {/* Step: Schedule */}
      {step === 'schedule' && (
        <div className="card fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <h2><Clock size={20} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Daily Updates</h2>
            <p style={{ marginTop: 4 }}>When should I send you new job matches?</p>
          </div>
          <div className="input-group">
            <label>Update time (UTC)</label>
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
          {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep('cv')}>← Back</button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={finish} disabled={loading}>
              {loading ? '⏳ Saving...' : '🚀 Start Job Search'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
