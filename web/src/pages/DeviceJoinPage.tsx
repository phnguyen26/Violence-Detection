import { useState, type FormEvent } from 'react'
import { Camera, ChevronRight } from 'lucide-react'
import { Brand } from '../components/Brand'
import { API_BASE } from '../constants'

export function DeviceJoinPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)

  const join = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setJoining(true)

    try {
      const response = await fetch(`${API_BASE}/api/sessions/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairing_code: code.trim().toUpperCase() }),
      })

      if (!response.ok) throw new Error()

      const result = (await response.json()) as { join_url: string }
      window.location.assign(new URL(result.join_url, window.location.origin).toString())
    } catch {
      setError('The pairing code is invalid or has expired.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <main className="device-join-page">
      <Brand />

      <div className="device-join-card">
        <div className="device-join-icon">
          <Camera size={32} />
        </div>

        <p className="eyebrow">CONNECT PHONE CAMERA</p>
        <h1>Enter pairing code</h1>
        <p className="muted">
          Enter the code shown on your computer to turn this phone into a security camera.
        </p>

        <form onSubmit={join}>
          <label htmlFor="device-code">PAIRING CODE</label>
          <input
            id="device-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-1234"
            autoComplete="one-time-code"
            required
          />
          <button className="primary-button" type="submit" disabled={joining}>
            {joining ? 'Connecting...' : 'Connect camera'} <ChevronRight size={16} />
          </button>
        </form>

        {error && (
          <p className="session-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
