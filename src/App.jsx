import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const INITIAL_FALLBACK_TASKS = [];

export default function App() {
  // Page Routing: 'auth' (Page 1) | 'todos' (Page 2)
  const [currentPage, setCurrentPage] = useState(() => {
    try {
      const saved = localStorage.getItem('taskflow_auth_user');
      return saved ? 'todos' : 'auth';
    } catch {
      return 'auth';
    }
  });

  // Authentication states
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('taskflow_auth_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [authToken, setAuthToken] = useState(() => {
    return localStorage.getItem('taskflow_auth_token') || null;
  });

  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Tasks state
  const [tasks, setTasks] = useState(() => {
    try {
      const saved = localStorage.getItem('taskflow_tasks');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (t) => t.id !== 'task-1' && t.id !== 'task-2' && t.id !== 'task-3'
          );
        }
      }
    } catch (e) {
      console.warn('Could not read localStorage:', e);
    }
    return INITIAL_FALLBACK_TASKS;
  });

  // Backend / Database status: 'checking' | 'connected' | 'db_disconnected' | 'server_offline'
  const [backendStatus, setBackendStatus] = useState('checking');

  // Form states
  const [inputText, setInputText] = useState('');

  // Input validation & empty check states
  const [inputError, setInputError] = useState(false);
  const [inputErrorMsg, setInputErrorMsg] = useState('');
  const inputRef = useRef(null);
  const errorTimeoutRef = useRef(null);

  // Filter states: 'all' | 'not_done' | 'done'
  const [currentFilter, setCurrentFilter] = useState('all');

  // Editing state
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');

  // Theme & Notifications
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('taskflow_theme') || 'dark';
  });
  const [toastMessage, setToastMessage] = useState(null);
  const [recentlyDeleted, setRecentlyDeleted] = useState(null);
  const toastTimeoutRef = useRef(null);

  // Sync to LocalStorage as safety backup
  useEffect(() => {
    try {
      localStorage.setItem('taskflow_tasks', JSON.stringify(tasks));
    } catch (e) {
      console.warn('Could not write to localStorage:', e);
    }
  }, [tasks]);

  // Sync theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('taskflow_theme', theme);
  }, [theme]);

  // Memoized Request Headers
  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
  }), [authToken]);

  // Fetch tasks from Express Backend & check MongoDB Atlas status
  const fetchTasksFromBackend = useCallback(async () => {
    try {
      setBackendStatus('checking');
      const healthRes = await fetch(`${API_BASE_URL}/health`);
      if (!healthRes.ok) throw new Error('Backend health check failed');
      const healthData = await healthRes.json();

      if (healthData.database === 'connected') {
        setBackendStatus('connected');
        const res = await fetch(`${API_BASE_URL}/todos`, { headers: authHeaders });
        if (res.ok) {
          const dbTodos = await res.json();
          const formatted = dbTodos.map((t) => ({
            id: t._id || t.id,
            text: t.text,
            isDone: Boolean(t.isDone),
            category: t.category || 'General',
            priority: t.priority || 'medium',
            createdAt: t.createdAt
              ? new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'Just now'
          }));
          setTasks(formatted);
        }
      } else {
        setBackendStatus('db_disconnected');
      }
    } catch (err) {
      console.warn('Express server not reachable:', err.message);
      setBackendStatus('server_offline');
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchTasksFromBackend();
    const interval = setInterval(fetchTasksFromBackend, 15000);
    return () => clearInterval(interval);
  }, [fetchTasksFromBackend]);

  // Show Toast
  const showToast = (msg, canUndo = false, type = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage({ text: msg, canUndo, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // ====================================================================
  // AUTHENTICATION LOGIC: SIGNUP, LOGIN, LOGOUT
  // ====================================================================
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      const endpoint = authMode === 'signup' ? `${API_BASE_URL}/auth/signup` : `${API_BASE_URL}/auth/login`;
      const bodyPayload =
        authMode === 'signup'
          ? { name: authName.trim(), email: authEmail.trim(), password: authPassword }
          : { email: authEmail.trim(), password: authPassword };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthError(data.message || 'Authentication failed. Please check credentials.');
        setAuthLoading(false);
        return;
      }

      setCurrentUser(data.user);
      setAuthToken(data.token);
      localStorage.setItem('taskflow_auth_user', JSON.stringify(data.user));
      localStorage.setItem('taskflow_auth_token', data.token);

      setCurrentPage('todos');
      setAuthPassword('');
      setAuthEmail('');
      setAuthName('');
      setAuthLoading(false);

      showToast(authMode === 'signup' ? `Welcome to TaskFlow, ${data.user.name}!` : `Welcome back, ${data.user.name}!`);
    } catch (err) {
      console.error('Auth request error:', err);
      setAuthError('Cannot reach server. Please ensure backend is running.');
      setAuthLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      setAuthError('');
      setAuthLoading(true);

      const credential = credentialResponse?.credential;
      if (!credential) {
        setAuthError('No Google credential token received.');
        setAuthLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential })
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthError(data.message || 'Google authentication failed.');
        setAuthLoading(false);
        return;
      }

      setCurrentUser(data.user);
      setAuthToken(data.token);
      localStorage.setItem('taskflow_auth_user', JSON.stringify(data.user));
      localStorage.setItem('taskflow_auth_token', data.token);

      setCurrentPage('todos');
      setAuthPassword('');
      setAuthEmail('');
      setAuthName('');
      setAuthLoading(false);

      showToast(`Welcome to TaskFlow, ${data.user.name}!`);
    } catch (err) {
      console.error('Google auth error:', err.message);
      setAuthError('Cannot reach server for Google sign in. Please verify backend is running.');
      setAuthLoading(false);
    }
  };

  const handleGoogleError = () => {
    setAuthError('Google sign in was unsuccessful or dismissed.');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthToken(null);
    localStorage.removeItem('taskflow_auth_user');
    localStorage.removeItem('taskflow_auth_token');
    setCurrentPage('auth');
    showToast('Signed out of your account. Returned to Sign In.');
  };

  // 1. CREATE TODO LIST ITEM
  const handleAddTask = async (e) => {
    e?.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) {
      setInputError(true);
      setInputErrorMsg('Create box is empty! Please write a task name before adding.');
      inputRef.current?.focus();

      showToast('⚠️ Create box is empty! Please enter a task to add.', false, 'error');

      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => {
        setInputError(false);
        setInputErrorMsg('');
      }, 4000);
      return;
    }

    setInputError(false);
    setInputErrorMsg('');
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);

    const optimisticId = 'task-' + Date.now();
    const newTask = {
      id: optimisticId,
      text: trimmed,
      isDone: false,
      category: 'General',
      priority: 'medium',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setTasks((prev) => [newTask, ...prev]);
    setInputText('');

    if (backendStatus === 'connected') {
      try {
        const res = await fetch(`${API_BASE_URL}/todos`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            text: trimmed,
            category: 'General',
            priority: 'medium'
          })
        });
        if (res.ok) {
          const created = await res.json();
          setTasks((prev) =>
            prev.map((t) =>
              t.id === optimisticId ? { ...t, id: created._id || created.id } : t
            )
          );
          showToast('Saved to MongoDB Atlas!');
          return;
        }
      } catch (err) {
        console.warn('Failed to save to MongoDB:', err);
      }
    }

    showToast('Task added to your list!');
  };

  // 2. TOGGLE DONE / NOT DONE (Instant & Silent)
  const handleToggleDone = async (id) => {
    const targetTask = tasks.find((t) => t.id === id);
    if (!targetTask) return;
    const nextStatus = !targetTask.isDone;

    setTasks((prev) =>
      prev.map((task) => {
        if (task.id === id) {
          return { ...task, isDone: nextStatus };
        }
        return task;
      })
    );

    if (backendStatus === 'connected') {
      try {
        await fetch(`${API_BASE_URL}/todos/${id}`, {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify({ isDone: nextStatus })
        });
      } catch (err) {
        console.warn('Failed to update status in MongoDB:', err);
      }
    }
  };

  // 3. DELETE A PARTICULAR TODO ITEM
  const handleDeleteTask = async (id) => {
    const taskToDelete = tasks.find((t) => t.id === id);
    if (!taskToDelete) return;

    setRecentlyDeleted(taskToDelete);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    showToast(`Deleted "${taskToDelete.text.slice(0, 24)}${taskToDelete.text.length > 24 ? '...' : ''}"`, true);

    if (backendStatus === 'connected') {
      try {
        await fetch(`${API_BASE_URL}/todos/${id}`, {
          method: 'DELETE',
          headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }
        });
      } catch (err) {
        console.warn('Failed to delete in MongoDB:', err);
      }
    }
  };

  // UNDO DELETE
  const handleUndoDelete = async () => {
    if (recentlyDeleted) {
      setTasks((prev) => [recentlyDeleted, ...prev]);

      if (backendStatus === 'connected') {
        try {
          await fetch(`${API_BASE_URL}/todos`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              text: recentlyDeleted.text,
              category: recentlyDeleted.category,
              priority: recentlyDeleted.priority
            })
          });
        } catch (err) {
          console.warn('Failed to restore in MongoDB:', err);
        }
      }

      setRecentlyDeleted(null);
      setToastMessage(null);
    }
  };

  // EDIT INLINE
  const handleStartEdit = (task) => {
    setEditingId(task.id);
    setEditingText(task.text);
  };

  const handleSaveEdit = async (id) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;

    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, text: trimmed } : t))
    );
    setEditingId(null);
    setEditingText('');

    if (backendStatus === 'connected') {
      try {
        await fetch(`${API_BASE_URL}/todos/${id}`, {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify({ text: trimmed })
        });
        showToast('Updated task in MongoDB');
      } catch (err) {
        console.warn('Failed to update in MongoDB:', err);
      }
    }
  };

  // CLEAR COMPLETED
  const handleClearCompleted = async () => {
    const doneCount = tasks.filter((t) => t.isDone).length;
    if (doneCount === 0) return;

    setTasks((prev) => prev.filter((t) => !t.isDone));
    showToast(`Cleared ${doneCount} completed task${doneCount > 1 ? 's' : ''}.`);

    if (backendStatus === 'connected') {
      try {
        await fetch(`${API_BASE_URL}/todos/completed/all`, {
          method: 'DELETE',
          headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }
        });
      } catch (err) {
        console.warn('Failed to clear completed in MongoDB:', err);
      }
    }
  };

  // CLEAR ALL
  const handleClearAll = async () => {
    if (tasks.length === 0) return;
    if (window.confirm('Are you sure you want to delete all tasks?')) {
      setTasks([]);
      showToast('All tasks cleared.');

      if (backendStatus === 'connected') {
        try {
          await fetch(`${API_BASE_URL}/todos`, {
            method: 'DELETE',
            headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }
          });
        } catch (err) {
          console.warn('Failed to clear all in MongoDB:', err);
        }
      }
    }
  };

  // COMPUTED STATS
  const totalCount = tasks.length;
  const doneCount = tasks.filter((t) => t.isDone).length;
  const notDoneCount = totalCount - doneCount;

  // FILTERED LIST
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (currentFilter === 'not_done') return !task.isDone;
      if (currentFilter === 'done') return task.isDone;
      return true;
    });
  }, [tasks, currentFilter]);

  return (
    <div className={`vision-workspace page-${currentPage}`}>
      {/* ====================================================================
          1. TOP FLOATING SYSTEM CAPSULE (Frosted Glass Pill)
          ==================================================================== */}
      <header className="vision-top-capsule" aria-label="System Controls">
        {/* Left: Window Gems */}
        <div className="window-gems" aria-hidden="true">
          <span className="gem gem-close" title="Close" />
          <span className="gem gem-min" title="Minimize" />
          <span className="gem gem-zoom" title="Zoom" />
        </div>

        {/* Center: Clean Page Navigation Switcher */}
        <nav className="page-switcher-capsule" aria-label="Page Navigation">
          <button
            type="button"
            className={`page-nav-pill ${currentPage === 'auth' ? 'active' : ''}`}
            onClick={() => {
              setCurrentPage('auth');
              setAuthError('');
            }}
            id="nav-page-1-auth"
          >
            Sign In
          </button>
          <button
            type="button"
            className={`page-nav-pill ${currentPage === 'todos' ? 'active' : ''}`}
            onClick={() => setCurrentPage('todos')}
            id="nav-page-2-todos"
          >
            Todo Workspace
          </button>
        </nav>

        {/* Right: Controls & User State */}
        <div className="capsule-controls">
          {currentUser && (
            <div className="user-account-capsule">
              {currentUser.avatar ? (
                <img src={currentUser.avatar} alt={currentUser.name} className="user-avatar-img" />
              ) : (
                <span className="user-avatar-placeholder">👤</span>
              )}
              <span className="user-name-text" title={currentUser.name}>
                {currentUser.name}
              </span>
              <button
                type="button"
                className="user-logout-btn"
                onClick={handleLogout}
                title="Sign out and return to Sign In"
              >
                Log Out
              </button>
            </div>
          )}

          <button
            type="button"
            className="glass-pill-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {/* ====================================================================
          PAGE 1: DEDICATED AUTHENTICATION PAGE (Transparent Frosted Glass Box)
          ==================================================================== */}
      {currentPage === 'auth' && (
        <section className="vision-auth-page-view" aria-label="Authentication Page">
          <div className="auth-page-card">
            <div className="auth-header">
              <div className="auth-logo-circle" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <h2>{authMode === 'login' ? 'Sign In' : 'Create Account'}</h2>
            </div>

            {/* Segmented Tab Bar for Login / Signup */}
            <div className="auth-tab-bar" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'login'}
                className={`auth-tab-btn ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('login');
                  setAuthError('');
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'signup'}
                className={`auth-tab-btn ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('signup');
                  setAuthError('');
                }}
              >
                Create Account
              </button>
            </div>

            {/* Error Message Alert Banner */}
            {authError && (
              <div className="input-error-banner shake-input" role="alert">
                <div className="input-error-content">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{authError}</span>
                </div>
                <button
                  type="button"
                  className="error-dismiss-btn"
                  onClick={() => setAuthError('')}
                  title="Dismiss error"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Auth Form */}
            <form onSubmit={handleAuthSubmit} className="auth-form">
              {authMode === 'signup' && (
                <div className="auth-field">
                  <label htmlFor="auth-name">Full Name</label>
                  <div className="glass-input-wrapper">
                    <span className="glass-input-icon">👤</span>
                    <input
                      id="auth-name"
                      type="text"
                      className="glass-task-input"
                      placeholder="e.g. Muhammed Razy"
                      value={authName}
                      onChange={(e) => {
                        setAuthName(e.target.value);
                        setAuthError('');
                      }}
                      required
                    />
                  </div>
                </div>
              )}

              <div className="auth-field">
                <label htmlFor="auth-email">Email Address</label>
                <div className="glass-input-wrapper">
                  <span className="glass-input-icon">✉️</span>
                  <input
                    id="auth-email"
                    type="email"
                    className="glass-task-input"
                    placeholder="name@example.com"
                    value={authEmail}
                    onChange={(e) => {
                      setAuthEmail(e.target.value);
                      setAuthError('');
                    }}
                    required
                  />
                </div>
              </div>

              <div className="auth-field">
                <label htmlFor="auth-password">Password</label>
                <div className="glass-input-wrapper">
                  <span className="glass-input-icon">🔑</span>
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    className="glass-task-input"
                    placeholder={authMode === 'signup' ? 'Min. 6 characters' : 'Enter password'}
                    value={authPassword}
                    onChange={(e) => {
                      setAuthPassword(e.target.value);
                      setAuthError('');
                    }}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? '👁️‍🗨️' : '👁️'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="auth-submit-btn"
                disabled={authLoading}
                id="btn-auth-submit"
              >
                {authLoading
                  ? 'Please wait...'
                  : authMode === 'login'
                    ? 'Sign In'
                    : 'Create Account'}
              </button>

              <div className="auth-divider">
                <span>or</span>
              </div>

              {import.meta.env.VITE_GOOGLE_CLIENT_ID ? (
                <div className="google-btn-container">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={handleGoogleError}
                    theme={theme === 'dark' ? 'filled_black' : 'outline'}
                    size="large"
                    shape="pill"
                    width="100%"
                    text={authMode === 'signup' ? 'signup_with' : 'signin_with'}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="google-custom-btn"
                  onClick={() =>
                    setAuthError('Google Client ID is missing. Add VITE_GOOGLE_CLIENT_ID to your .env file.')
                  }
                  title="Configure VITE_GOOGLE_CLIENT_ID in .env"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                  <span>{authMode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}</span>
                </button>
              )}

              <div className="auth-footer-links">
                <button
                  type="button"
                  className="guest-skip-link"
                  onClick={() => {
                    setCurrentPage('todos');
                    setAuthError('');
                  }}
                  id="btn-continue-guest"
                >
                  Continue as Guest →
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {/* ====================================================================
          PAGE 2: DEDICATED TODO WORKSPACE (Transparent Frosted Glass Box)
          ==================================================================== */}
      {currentPage === 'todos' && (
        <main className="vision-window" aria-label="Page 2: Todo Workspace">
          {/* Header Area */}
          <div className="window-header">
            <div className="window-title-row">
              <div className="brand-glass-lockup">
                <div className="brand-icon-glass" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 11 12 14 22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </div>
                <div className="brand-text">
                  <h1>TaskFlow</h1>
                </div>
              </div>

              {/* Quick stats pills */}
              <div className="stat-pills-row">
                <span className="stat-pill-unit total">
                  Total <span className="stat-pill-num">{totalCount}</span>
                </span>
                <span className="stat-pill-unit pending">
                  <span className="filter-status-dot not-done" /> Not Done <span className="stat-pill-num">{notDoneCount}</span>
                </span>
                <span className="stat-pill-unit done">
                  <span className="filter-status-dot done" /> Done <span className="stat-pill-num">{doneCount}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Create Task Bar (Translucent Google-style Capsule Pill) */}
          <section className="vision-create-bar" aria-label="Create Task Section">
            <form onSubmit={handleAddTask}>
              <div className="input-capsule-row">
                <div className="glass-input-wrapper">
                  <span className="glass-input-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                  <input
                    ref={inputRef}
                    id="new-task-input"
                    type="text"
                    className={`glass-task-input ${inputError ? 'input-error shake-input' : ''}`}
                    placeholder="What needs to be done? Type and press Enter..."
                    value={inputText}
                    onChange={(e) => {
                      setInputText(e.target.value);
                      if (inputError) {
                        setInputError(false);
                        setInputErrorMsg('');
                      }
                    }}
                    autoComplete="off"
                  />
                </div>

                <button type="submit" className="btn-glass-primary" id="btn-add-task">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Task
                </button>
              </div>

              {/* Error Banner when empty */}
              {inputError && (
                <div className="input-error-banner" role="alert" style={{ marginTop: '0.75rem' }}>
                  <div className="input-error-content">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{inputErrorMsg || 'Create box is empty! Please write something.'}</span>
                  </div>
                  <button
                    type="button"
                    className="error-dismiss-btn"
                    onClick={() => {
                      setInputError(false);
                      setInputErrorMsg('');
                    }}
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              )}
            </form>
          </section>

          {/* Filter Bar (Only Filters, Translucent Segmented Pill) */}
          <section className="vision-filter-bar" aria-label="Task Filters">
            <div className="segmented-control-glass">
              <button
                type="button"
                className={`segment-btn ${currentFilter === 'all' ? 'active' : ''}`}
                onClick={() => setCurrentFilter('all')}
                id="filter-all"
              >
                All <span className="segment-count">{totalCount}</span>
              </button>
              <button
                type="button"
                className={`segment-btn ${currentFilter === 'not_done' ? 'active' : ''}`}
                onClick={() => setCurrentFilter('not_done')}
                id="filter-not-done"
              >
                <span className="filter-status-dot not-done" /> Not Done <span className="segment-count">{notDoneCount}</span>
              </button>
              <button
                type="button"
                className={`segment-btn ${currentFilter === 'done' ? 'active' : ''}`}
                onClick={() => setCurrentFilter('done')}
                id="filter-done"
              >
                <span className="filter-status-dot done" /> Done <span className="segment-count">{doneCount}</span>
              </button>
            </div>
          </section>

          {/* Todo Items List */}
          <div className="vision-todo-list" aria-label="Todo Items List">
            {filteredTasks.length === 0 ? (
              <div className="vision-empty-state">
                <div className="empty-glass-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                </div>
                <h3 className="empty-title">
                  {currentFilter === 'done'
                    ? 'No completed tasks yet'
                    : currentFilter === 'not_done'
                      ? 'All clear! No pending tasks.'
                      : 'Your todo list is empty'}
                </h3>
                <p className="empty-desc">
                  {currentFilter === 'all'
                    ? 'Type a task above and press Enter or Add Task.'
                    : 'Switch filters or add a new task above.'}
                </p>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <div
                  key={task.id}
                  id={`todo-${task.id}`}
                  className={`vision-todo-item ${task.isDone ? 'is-done' : ''}`}
                >
                  <div className="todo-item-left">
                    <button
                      type="button"
                      className={`todo-tick-btn ${task.isDone ? 'done' : 'not-done'}`}
                      onClick={() => handleToggleDone(task.id)}
                      title={task.isDone ? 'Mark as Not Done' : 'Mark as Done'}
                      aria-label={task.isDone ? 'Mark as Not Done' : 'Mark as Done'}
                    >
                      {task.isDone ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <span className="red-dot" />
                      )}
                    </button>

                    <div className="todo-content-wrapper">
                      {editingId === task.id ? (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input
                            type="text"
                            className="glass-task-input"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(task.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            autoFocus
                            style={{ padding: '0.45rem 0.85rem' }}
                          />
                          <button
                            type="button"
                            className="footer-glass-btn"
                            onClick={() => handleSaveEdit(task.id)}
                            style={{ padding: '0.45rem 0.85rem' }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="footer-glass-btn"
                            onClick={() => setEditingId(null)}
                            style={{ padding: '0.45rem 0.85rem' }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <span
                            className="todo-text"
                            onDoubleClick={() => handleStartEdit(task)}
                            title="Double-click to edit text"
                          >
                            {task.text}
                          </span>
                          <div className="todo-meta">
                            <span>Added {task.createdAt}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="todo-item-side">
                    <button
                      type="button"
                      className="btn-glass-action"
                      onClick={() => handleStartEdit(task)}
                      title="Edit task"
                      id={`edit-btn-${task.id}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      className="btn-glass-action"
                      onClick={() => handleDeleteTask(task.id)}
                      title="Delete this task"
                      id={`delete-btn-${task.id}`}
                      aria-label="Delete this task"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Window Footer Bar */}
          <footer className="window-footer-bar">
            <div>
              <span>Showing {filteredTasks.length} of {totalCount} task{totalCount === 1 ? '' : 's'}</span>
            </div>

            <div className="footer-actions">
              {doneCount > 0 && (
                <button
                  type="button"
                  className="footer-glass-btn"
                  onClick={handleClearCompleted}
                  id="btn-clear-completed"
                >
                  Clear Completed ({doneCount})
                </button>
              )}

              {totalCount > 0 && (
                <button
                  type="button"
                  className="footer-glass-btn"
                  onClick={handleClearAll}
                  id="btn-clear-all"
                >
                  Clear All
                </button>
              )}
            </div>
          </footer>
        </main>
      )}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <aside className={`toast-notice ${toastMessage.type === 'error' ? 'toast-error' : ''}`} role="status" aria-live="polite">
          <span>{toastMessage.text}</span>
          {toastMessage.canUndo && (
            <button
              type="button"
              className="toast-btn"
              onClick={handleUndoDelete}
            >
              Undo
            </button>
          )}
        </aside>
      )}
    </div>
  );
}
