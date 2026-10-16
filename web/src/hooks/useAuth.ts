import { useState, useEffect } from 'react'
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onIdTokenChanged,
  type User,
} from 'firebase/auth'
import { auth } from '../firebase'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [idToken, setIdToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (u) => {
      setUser(u)
      try {
        setIdToken(u ? await u.getIdToken() : null)
      } catch {
        setIdToken(null)
      } finally {
        setLoading(false)
      }
    })
    return unsubscribe
  }, [])

  const signInGoogle = async () => {
    const provider = new GoogleAuthProvider()
    await signInWithPopup(auth, provider)
  }

  const signOut = async () => {
    await fbSignOut(auth)
    setUser(null)
    setIdToken(null)
  }

  return { user, idToken, loading, signInGoogle, signOut }
}
