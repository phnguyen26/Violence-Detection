import { useState, type FormEvent } from 'react'
import { ChevronRight, CircleHelp, Smartphone } from 'lucide-react'
import { Brand } from '../components/Brand'

interface LoginPageProps {
  onLogin: () => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onLogin()
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
          <p className="muted">Use your EZVIZ account to continue.</p>

          <form onSubmit={handleSubmit}>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />

            <div className="form-row">
              <label className="check-label">
                <input type="checkbox" /> Remember me
              </label>
              <button type="button" className="link-button">
                Forgot password?
              </button>
            </div>

            <button className="primary-button" type="submit">
              Sign in <ChevronRight size={16} />
            </button>
          </form>

          <div className="login-divider">
            <span /> or <span />
          </div>

          <button className="secondary-button" onClick={onLogin}>
            <Smartphone size={16} /> Continue with mobile
          </button>

          <p className="signup-copy">
            New to EZVIZ?{' '}
            <button className="link-button">Create an account</button>
          </p>
        </div>

        <p className="legal-copy">By continuing, you agree to our Terms of Service and Privacy Policy.</p>
      </section>
    </main>
  )
}
