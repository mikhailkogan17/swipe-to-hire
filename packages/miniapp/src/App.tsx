import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layers, Heart, Settings } from 'lucide-react';
import './index.css';
import { OnboardingPage } from './pages/OnboardingPage';
import { SwipePage } from './pages/SwipePage';
import { LikedPage } from './pages/LikedPage';
import { SettingsPage } from './pages/SettingsPage';
import { api, type UserProfile } from './api';

// Get Telegram user ID safely (falls back for browser dev mode)
export function getTelegramUserId(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp;
    return tg?.initDataUnsafe?.user?.id ?? 0;
  } catch {
    const params = new URLSearchParams(window.location.search);
    return Number(params.get('dev_telegram_user_id') ?? '0');
  }
}


function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = [
    { path: '/', icon: <Layers size={22} />, label: 'Jobs' },
    { path: '/liked', icon: <Heart size={22} />, label: 'Applied' },
    { path: '/settings', icon: <Settings size={22} />, label: 'Settings' },
  ];

  return (
    <nav className="bottom-nav">
      {tabs.map(t => (
        <button
          key={t.path}
          className={`nav-item ${location.pathname === t.path ? 'active' : ''}`}
          onClick={() => navigate(t.path)}
        >
          <span className="nav-icon">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function AppRoutes({ profile }: { profile: UserProfile }) {
  const withNav = (el: ReactNode, showNav = true) => (
    <div className="app-shell fade-up">
      <div className="page" style={{ overflow: 'hidden', padding: 0 }}>
        {el}
      </div>
      {showNav && <BottomNav />}
    </div>
  );

  if (!profile.onboarded) {
    return (
      <div className="app-shell">
        <OnboardingPage telegramUserId={profile.telegramUserId} />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/"         element={withNav(<SwipePage  telegramUserId={profile.telegramUserId} />)} />
      <Route path="/liked"    element={withNav(<LikedPage  telegramUserId={profile.telegramUserId} />)} />
      <Route path="/settings" element={withNav(<SettingsPage telegramUserId={profile.telegramUserId} profile={profile} />)} />
      <Route path="/onboarding" element={<Navigate to="/" replace />} />
      <Route path="*"         element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const telegramUserId = getTelegramUserId();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!telegramUserId) {
      setError('Could not identify Telegram user. Please open via bot.');
      return;
    }
    api.getProfile(telegramUserId)
      .then(setProfile)
      .catch(() => setError('Failed to connect to server.'));
  }, [telegramUserId]);

  if (error) {
    return (
      <div className="app-shell">
        <div className="empty-state">
          <div className="empty-icon">⚠️</div>
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="app-shell">
        <div className="empty-state loading">
          <div className="empty-icon">⏳</div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <AppRoutes profile={profile} />
    </BrowserRouter>
  );
}
