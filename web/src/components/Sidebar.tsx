import { Bell, Camera, ChevronDown, Home, LayoutGrid, LogOut, Plus, ShieldCheck } from 'lucide-react'
import { Brand } from './Brand'
import type { Page, SessionState } from '../types'

interface SidebarProps {
  page: Page
  setPage: (page: Page) => void
  onLogout: () => void
  sessionState?: SessionState
}

export function Sidebar({ page, setPage, onLogout, sessionState }: SidebarProps) {
  return (
    <aside className="sidebar">
      <Brand />

      <div className="home-switcher">
        <span className="home-avatar">H</span>
        <span>
          <strong>Henderson Home</strong>
          <small>Personal account</small>
        </span>
        <ChevronDown size={15} />
      </div>

      <p className="nav-label">MAIN MENU</p>
      <nav>
        <button
          className={page === 'dashboard' ? 'nav-link active' : 'nav-link'}
          onClick={() => setPage('dashboard')}
        >
          <Home size={17} /> Overview
        </button>

        <button
          className={page === 'monitor' ? 'nav-link active' : 'nav-link'}
          onClick={() => setPage('monitor')}
        >
          <Camera size={17} /> Live Monitor
          {sessionState === 'connected' && <span className="nav-count">LIVE</span>}
        </button>

        <button className="nav-link">
          <LayoutGrid size={17} /> All cameras <span className="nav-count">3</span>
        </button>

        <button className="nav-link">
          <Bell size={17} /> Notifications <span className="notification-dot" />
        </button>
      </nav>

      <p className="nav-label nav-label-spaced">MANAGE</p>
      <nav>
        <button
          className={page === 'add-device' ? 'nav-link active' : 'nav-link'}
          onClick={() => setPage('add-device')}
        >
          <Plus size={17} /> Connect phone
          {sessionState === 'connected' && <span className="notification-dot" style={{ background: '#22c55e' }} />}
        </button>
      </nav>

      <div className="sidebar-bottom">
        <div className="security-note">
          <ShieldCheck size={18} />
          <span>
            <strong>
              {sessionState === 'connected'
                ? 'Camera Live'
                : sessionState === 'waiting'
                  ? 'Waiting for Phone...'
                  : 'Protected'}
            </strong>
            <small>YOLO Pure WebSocket</small>
          </span>
        </div>
        <button className="nav-link" onClick={onLogout}>
          <LogOut size={17} /> Sign out
        </button>
      </div>
    </aside>
  )
}
