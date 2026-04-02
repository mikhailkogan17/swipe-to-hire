import { useState, useEffect } from 'react';
import { api, type JobMatch } from '../api';

export function LikedPage({ telegramUserId }: { telegramUserId: number }) {
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLikedJobs(telegramUserId)
      .then(r => setJobs(r.jobs))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [telegramUserId]);

  if (loading) {
    return (
      <div className="empty-state loading" style={{ height: '100%' }}>
        <div className="empty-icon">⏳</div>
        <p>Loading...</p>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="empty-state fade-up" style={{ height: '100%' }}>
        <div className="empty-icon">👆</div>
        <h2>No liked jobs yet</h2>
        <p>Swipe right on positions you're interested in to see them here.</p>
      </div>
    );
  }

  return (
    <div className="page fade-up" style={{ overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>✅ Liked Positions</h2>
        <span className="badge badge-green">{jobs.length}</span>
      </div>
      <p style={{ marginTop: -8 }}>Apply to these positions to move forward.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {jobs.map(job => (
          <a
            key={job.jobId}
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="job-list-item"
          >
            <div className="job-list-item-info">
              <div className="job-list-item-title">{job.title}</div>
              <div className="job-list-item-sub">
                {job.company}
                {job.locations[0] && ` · ${job.locations[0].workType === 'remote' ? 'Remote' : (job.locations[0].address ?? job.locations[0].addressKind)}`}
                {job.conformancePercentage !== undefined && ` · ${job.conformancePercentage}% match`}
              </div>
            </div>
            <span style={{ color: 'var(--accent)', fontSize: 20 }}>→</span>
          </a>
        ))}
      </div>
    </div>
  );
}
