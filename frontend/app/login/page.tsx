'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties, FormEvent } from 'react';
import * as T from '../theme';
import { COLOR, FONT, RADIUS } from '../theme';
import Mark from '../components/Mark';
import Ribbon from '../components/Ribbon';
import { me, signIn } from '../lib/session';

const LANDING = '/brief';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('local');

  // Someone arriving at /login with a live cookie has a session already, and
  // asking them to type it again would be theatre.
  useEffect(() => {
    let live = true;
    me()
      .then((m) => {
        if (!live) return;
        setProvider(m.provider);
        if (m.user) router.replace(LANDING);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    if (!email.trim()) return setError('Enter your email address.');
    if (!password) return setError('Enter your password.');

    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password, remember);
      router.replace(LANDING);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={S.page}>
      <div style={{ ...S.field, ...S.fieldTop }} aria-hidden />
      <div style={{ ...S.field, ...S.fieldRight }} aria-hidden />
      <Ribbon />

      <div style={S.stage}>
        <div style={S.identity}>
          <Mark size={34} />
          <div style={S.wordmark}>
            <span style={S.line1}>KeyStone</span>
            <span style={S.line2}>MacroDesk</span>
          </div>
        </div>

        <form style={S.card} onSubmit={submit} noValidate>
          <h1 style={S.heading}>Sign in to your account</h1>

          <label style={S.label} htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@keystone.ca"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            style={S.input}
            disabled={busy}
          />

          <label style={{ ...S.label, marginTop: 14 }} htmlFor="password">
            Password
          </label>
          <div style={S.passwordWrap}>
            <input
              id="password"
              name="password"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              style={{ ...S.input, paddingRight: 40 }}
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              style={S.reveal}
              aria-label={reveal ? 'Hide password' : 'Show password'}
              title={reveal ? 'Hide password' : 'Show password'}
            >
              <EyeIcon off={reveal} />
            </button>
          </div>

          <div style={S.rowBetween}>
            <label style={S.remember}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                style={S.checkbox}
              />
              Remember me
            </label>
            <span style={S.hint} title="No reset flow yet. Ask the desk admin to reset it.">
              Forgot password?
            </span>
          </div>

          <button
            type="submit"
            style={{ ...T.control, ...T.controlPrimary, ...S.submit, ...(busy ? T.controlOff : {}) }}
            disabled={busy}
          >
            {busy ? 'Signing in' : 'Sign in'}
          </button>

          {error && (
            <p style={S.error} role="alert">
              {error}
            </p>
          )}

          {provider !== 'local' && <p style={S.notice}>Signed in through {provider}.</p>}
        </form>
      </div>
    </main>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden>
      <path d="M23.821,11.181v0C22.943,9.261,19.5,3,12,3S1.057,9.261.179,11.181a1.969,1.969,0,0,0,0,1.64C1.057,14.739,4.5,21,12,21s10.943-6.261,11.821-8.181A1.968,1.968,0,0,0,23.821,11.181ZM12,18a6,6,0,1,1,6-6A6.006,6.006,0,0,1,12,18Z" />
      <circle cx="12" cy="12" r="4" fill={off ? 'currentColor' : COLOR.bg} />
      {off && <path d="M3 3 L21 21" stroke={COLOR.bg} strokeWidth="2.4" fill="none" />}
    </svg>
  );
}

const S: Record<string, CSSProperties> = {
  page: {
    position: 'relative',
    minHeight: '100vh',
    background: COLOR.bg,
    color: COLOR.ink,
    fontFamily: FONT.body,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 32px',
    overflow: 'hidden',
  },
  // ambient colour behind the page, as specified in design/login.html
  field: {
    position: 'fixed',
    borderRadius: '50%',
    filter: 'blur(90px)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  fieldTop: { width: 560, height: 560, top: '4%', left: '2%', background: 'rgba(26,168,151,.18)' },
  fieldRight: {
    width: 500,
    height: 500,
    top: -120,
    right: '6%',
    background: 'rgba(18,137,123,.22)',
  },
  stage: {
    position: 'relative',
    // above the ribbon canvas, which sits at 1
    zIndex: 2,
    width: '100%',
    maxWidth: 900,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    gap: 56,
    alignItems: 'center',
  },
  identity: { minWidth: 0 },
  wordmark: {
    fontFamily: FONT.display,
    fontWeight: 700,
    fontStyle: 'italic',
    lineHeight: 1,
    margin: '22px 0 0',
  },
  line1: { display: 'block', fontSize: 'clamp(40px,5.5vw,66px)', color: COLOR.ink },
  line2: {
    ...T.wordmarkGlass,
    display: 'block',
    fontSize: 'clamp(40px,5.5vw,66px)',
    marginLeft: '.34em',
  },
  card: {
    background: COLOR.panel,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: COLOR.line,
    borderRadius: RADIUS.card,
    padding: '28px 26px 24px',
    display: 'flex',
    flexDirection: 'column',
  },
  heading: {
    fontFamily: FONT.display,
    fontSize: 21,
    fontWeight: 700,
    fontStyle: 'italic',
    margin: '0 0 22px',
  },
  label: { fontSize: 10.5, letterSpacing: '.2px', color: COLOR.dim, marginBottom: 6 },
  input: { ...T.input, background: COLOR.bg, padding: '10px 11px', fontSize: 13, width: '100%' },
  passwordWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  reveal: {
    position: 'absolute',
    right: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'solid',
    background: 'transparent',
    color: COLOR.dim,
    cursor: 'pointer',
  },
  rowBetween: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    margin: '18px 0',
  },
  remember: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: COLOR.dim,
    cursor: 'pointer',
  },
  checkbox: { accentColor: COLOR.accent, width: 13, height: 13 },
  // not a link: there is no reset flow behind it yet, and a dead link is worse
  // than a line of text saying who to ask
  hint: { fontSize: 11.5, color: COLOR.dim, cursor: 'help', textDecoration: 'underline dotted' },
  submit: { width: '100%', textAlign: 'center', padding: '11px', fontSize: 13 },
  error: { fontSize: 12, color: COLOR.bad, margin: '12px 0 0' },
  notice: {
    fontSize: 11,
    lineHeight: 1.7,
    color: COLOR.dim,
    margin: '20px 0 0',
    paddingTop: 14,
    borderTop: `1px solid ${COLOR.hair}`,
  },
};
