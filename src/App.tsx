import { lazy, Suspense, useEffect } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import Layout from './components/Layout';
import Onboarding from './pages/Onboarding';
import Feed from './pages/Feed';
import SignalDetails from './pages/SignalDetails';
import History from './pages/History';
import Calculator from './pages/Calculator';
import Settings from './pages/Settings';
import Contact from './pages/Contact';
import Profile from './pages/Profile';
import ResetPassword from './pages/ResetPassword';
import { StoreProvider, useStore } from './lib/store';
import { addNotificationTapListener } from './lib/nativePush';

// The admin panel only exists when a secret path is configured at build time.
// Builds without VITE_ADMIN_PATH (e.g. the Android app) have no admin route.
const ADMIN_PATH = (import.meta.env.VITE_ADMIN_PATH ?? '').replace(/\/+$/, '');
// Written as a direct env check so the bundler drops the Admin chunk entirely
// from builds without an admin path (the Play app ships no admin code).
const Admin = import.meta.env.VITE_ADMIN_PATH ? lazy(() => import('./pages/Admin')) : null;

/** Opens signal details when the app is launched from a notification deep link. */
function DeepLinkHandler(): null {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const signalId = params.get('signalId');
    if (signalId && /^\d+$/.test(signalId)) {
      navigate('/signal/' + signalId, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native: a tapped push notification carries the signal to open.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    void addNotificationTapListener((signalId) => {
      navigate('/signal/' + signalId);
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else stop = cleanup;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [navigate]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return null;
}

function Shell(): React.ReactElement {
  const { onboarded } = useStore();
  const location = useLocation();
  const isAdminRoute = ADMIN_PATH !== '' && location.pathname === ADMIN_PATH;
  const isResetRoute = location.pathname.startsWith('/reset-password');

  if (isResetRoute) {
    return <ResetPassword />;
  }

  if (!onboarded && !isAdminRoute) {
    return <Onboarding />;
  }

  if (isAdminRoute && Admin) {
    return (
      <Suspense fallback={null}>
        <Admin />
      </Suspense>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/signal/:id" element={<SignalDetails />} />
        <Route path="/history" element={<History />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/auth" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <StoreProvider>
        <DeepLinkHandler />
        <Shell />
      </StoreProvider>
    </BrowserRouter>
  );
}
