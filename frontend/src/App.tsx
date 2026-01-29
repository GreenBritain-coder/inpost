import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AddTracking from './components/AddTracking';
import UploadCSV from './components/UploadCSV';
import Analytics from './components/Analytics';
import Logs from './components/Logs';
import LastScanned from './components/LastScanned';
import CleanupLogs from './components/CleanupLogs';
import Layout from './components/Layout';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </PrivateRoute>
        }
      />
      <Route
        path="/add"
        element={
          <PrivateRoute>
            <Layout>
              <AddTracking />
            </Layout>
          </PrivateRoute>
        }
      />
      <Route
        path="/upload"
        element={
          <PrivateRoute>
            <Layout>
              <UploadCSV />
            </Layout>
          </PrivateRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <PrivateRoute>
            <Layout>
              <Analytics />
            </Layout>
          </PrivateRoute>
        }
      />
      <Route
        path="/logs"
        element={
          <PrivateRoute>
            <Layout>
              <Logs />
            </Layout>
          </PrivateRoute>
        }
      />
      <Route
        path="/last-scanned"
        element={
          <PrivateRoute>
            <Layout>
              <LastScanned />
            </Layout>
          </PrivateRoute>
        }
      />
      <Route
        path="/cleanup-logs"
        element={
          <PrivateRoute>
            <Layout>
              <CleanupLogs />
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;

