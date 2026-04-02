import { useState, useEffect, useRef } from 'react';
import TinderCard from 'react-tinder-card';
import { api, type JobMatch } from '../api';

export function SwipePage({ telegramUserId }: { telegramUserId: number }) {
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(0); // how many swiped
  const childRefs = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    api.getJobs(telegramUserId)
      .then(r => setJobs(r.jobs))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [telegramUserId]);

  const remaining = jobs.length - gone;

  async function handleSwipe(direction: string, job: JobMatch) {
    const action = direction === 'right' ? 'like' : 'dislike';
    setGone(g => g + 1);
    await api.swipe(telegramUserId, job.jobId, action).catch(console.error);
  }

  async function swipeManual(job: JobMatch, direction: 'left' | 'right') {
    const ref = childRefs.current.get(job.jobId);
    if (ref) await ref.swipe(direction);
  }

  if (loading) {
    return (
      <div className="empty-state loading">
        <div className="empty-icon">🔍</div>
        <p>Loading your matches...</p>
      </div>
    );
  }

  if (jobs.length === 0 || remaining === 0) {
    return (
      <div className="empty-state fade-up">
        <div className="empty-icon">🎯</div>
        <h2>All caught up!</h2>
        <p>No new positions right now. I'll notify you when new matches arrive.</p>
      </div>
    );
  }

  // Show only the top 3 cards (bottom of array = top of stack visually)
  const visible = jobs.slice(gone, gone + 3);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Counter */}
      <div style={{ padding: '16px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Your Matches</h2>
        <span className="badge badge-purple">{remaining} left</span>
      </div>

      {/* Swipe stack */}
      <div className="swipe-container">
        {[...visible].reverse().map((job, i) => {
          const isTop = i === visible.length - 1;
          return (
            <TinderCard
              key={job.jobId}
              ref={(el: any) => { if (el) childRefs.current.set(job.jobId, el); }}
              onSwipe={(dir) => handleSwipe(dir, job)}
              preventSwipe={['up', 'down']}
            >
              <div
                className="swipe-card fade-up"
                style={{ zIndex: i, transform: isTop ? 'none' : `scale(${0.97 - (visible.length - 1 - i) * 0.02}) translateY(${(visible.length - 1 - i) * 10}px)` }}
              >
                <div className="swipe-card-inner">
                  {/* Header */}
                  <div className="swipe-header">
                    <div>
                      <div className="company-name">{job.company}</div>
                      <div className="job-title">{job.title}</div>
                    </div>
                    {job.conformancePercentage !== undefined && (
                      <div className="match-score">{job.conformancePercentage}%</div>
                    )}
                  </div>

                  {/* Location badges */}
                  <div className="location-row">
                    {job.locations.map((loc: import('@swipe-to-hire/types').JobLocation, li: number) => (
                      <span key={li} className={`badge ${loc.workType === 'remote' ? 'badge-green' : 'badge-purple'}`}>
                        {loc.workType === 'remote' ? '🌐 Remote' : `📍 ${loc.address ?? loc.addressKind}`}
                      </span>
                    ))}
                    {job.minExperience > 0 && (
                      <span className="badge badge-yellow">
                        {job.minExperience}+ yrs
                      </span>
                    )}
                    {job.needsHumanReview && (
                      <span className="badge badge-red">⚠️ Review</span>
                    )}
                  </div>

                  {/* Skills */}
                  {job.requiredSkills.length > 0 && (
                    <div className="chip-grid" style={{ marginBottom: 12 }}>
                      {job.requiredSkills.slice(0, 6).map((s: string) => (
                        <span key={s} className="chip" style={{ fontSize: 11, padding: '3px 10px' }}>{s}</span>
                      ))}
                    </div>
                  )}

                  {/* Agent notes */}
                  {job.agentNotes && (
                    <div className="agent-notes">
                      🤖 {job.agentNotes}
                    </div>
                  )}

                  {/* Apply link (tap) */}
                  <a
                    href={job.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary"
                    style={{ marginTop: 14, fontSize: 13 }}
                    onClick={e => e.stopPropagation()}
                  >
                    🔗 View Job Posting
                  </a>
                </div>
              </div>
            </TinderCard>
          );
        })}
      </div>

      {/* Action buttons */}
      {visible.length > 0 && (
        <div className="swipe-actions">
          <button
            className="swipe-btn swipe-btn-dislike"
            onClick={() => swipeManual(visible[visible.length - 1], 'left')}
            title="Not interested"
          >
            ✕
          </button>
          <button
            className="swipe-btn swipe-btn-like"
            onClick={() => swipeManual(visible[visible.length - 1], 'right')}
            title="Interested"
          >
            ✓
          </button>
        </div>
      )}
    </div>
  );
}
