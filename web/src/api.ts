import { auth } from './firebase'

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Sign in first')
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(path, {
    ...init,
    headers,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === 'string' ? error.detail : `Request failed (${response.status})`
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}
