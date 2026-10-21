import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const requiredEnv = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
} as const

const missingEnv = Object.entries(requiredEnv)
  .filter(([, value]) => !value)
  .map(([key]) => `VITE_FIREBASE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`)

if (missingEnv.length > 0) {
  throw new Error(`Missing Firebase environment variables: ${missingEnv.join(', ')}`)
}

const firebaseConfig = {
  ...requiredEnv,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
