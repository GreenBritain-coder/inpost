import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user: _user, logout } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="layout">
      <nav className="navbar">
        <div className="nav-container">
          <div className="nav-header">
            <h1 className="nav-title">InPost Tracking</h1>
            <button 
              className="mobile-menu-toggle"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              <span></span>
              <span></span>
              <span></span>
            </button>
          </div>
          <div className={`nav-links ${mobileMenuOpen ? 'mobile-open' : ''}`}>
            <Link
              to="/"
              className={location.pathname === '/' ? 'active' : ''}
              onClick={() => setMobileMenuOpen(false)}
            >
              Dashboard
            </Link>
            <Link
              to="/add"
              className={location.pathname === '/add' ? 'active' : ''}
              onClick={() => setMobileMenuOpen(false)}
            >
              Add Tracking
            </Link>
            <Link
              to="/upload"
              className={location.pathname === '/upload' ? 'active' : ''}
              onClick={() => setMobileMenuOpen(false)}
            >
              Upload CSV
            </Link>
            <Link
              to="/analytics"
              className={location.pathname === '/analytics' ? 'active' : ''}
              onClick={() => setMobileMenuOpen(false)}
            >
              Analytics
            </Link>
            <Link
              to="/logs"
              className={location.pathname === '/logs' ? 'active' : ''}
              onClick={() => setMobileMenuOpen(false)}
            >
              Status Logs
            </Link>
            <Link
              to="/last-scanned"
              className={location.pathname === '/last-scanned' ? 'active' : ''}
              onClick={() => setMobileMenuOpen(false)}
            >
              Last Scanned
            </Link>
            <Link
              to="/cleanup-logs"
              className={location.pathname === '/cleanup-logs' ? 'active' : ''}
              onClick={() => setMobileMenuOpen(false)}
            >
              Cleanup Logs
            </Link>
          </div>
          <div className={`nav-actions ${mobileMenuOpen ? 'mobile-open' : ''}`}>
            <button onClick={logout} className="logout-btn">
              Logout
            </button>
          </div>
        </div>
      </nav>
      <main className="main-content">{children}</main>
    </div>
  );
}

