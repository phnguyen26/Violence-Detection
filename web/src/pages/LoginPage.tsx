import { useState, type FormEvent } from 'react'
import { ChevronRight, CircleHelp, Loader2 } from 'lucide-react'
import { Brand } from '../components/Brand'

interface LoginPageProps {
  onSignInGoogle: () => Promise<void>
}

export function LoginPage({ onSignInGoogle }: LoginPageProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleGoogle = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await onSignInGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      {/* Left art panel */}
      <div className="login-art">
        <div className="art-copy">
          <Brand />
          <p className="eyebrow">SMART HOME SECURITY</p>
          <h1>
            See what
            <br />
            <em>matters.</em>
          </h1>
          <p>Simple, secure monitoring for every corner of your home.</p>
        </div>
        <div className="art-status">
          <span className="status-dot" /> All systems operational <span>•</span> 24/7 protection
        </div>
      </div>

      {/* Right sign-in panel */}
      <section className="login-panel">
        <div className="login-panel-head">
          <Brand />
          <button className="help-button" aria-label="Help">
            <CircleHelp size={18} />
          </button>
        </div>

        <div className="login-form">
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Sign in to your home</h2>
          <p className="muted">Use your Google account to continue.</p>

          {error && (
            <p style={{ color: 'var(--danger, #ef4444)', fontSize: '0.875rem', margin: '0 0 12px' }}>
              {error}
            </p>
          )}

          <form onSubmit={handleGoogle}>
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? (
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <svg width="16" height="16" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                </svg>
              )}
              {loading ? 'Signing in…' : 'Continue with Google'} {!loading && <ChevronRight size={16} />}
            </button>
          </form>

          <p className="signup-copy" style={{ marginTop: '24px' }}>
            Your account is secured by Google Sign-In.
            <br />
            <span style={{ opacity: 0.5 }}>No password stored on our servers.</span>
          </p>
        </div>

        <p className="legal-copy">By continuing, you agree to our Terms of Service and Privacy Policy.</p>
      </section>
    </main>
  )
}
