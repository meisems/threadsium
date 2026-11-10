import React, { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AuthUser, DirectoryToken, api } from "./lib/api";
import { SEEDED_TOKENS } from "./config/tokens";
import { Layout } from "./components/Layout";
import { Landing } from "./pages/Landing";
import { AuthPage } from "./pages/AuthPage";
import { Home } from "./pages/Home";
import { Search } from "./pages/Search";
import { Token } from "./pages/Token";
import { PostThread } from "./pages/PostThread";
import { UserProfile } from "./pages/UserProfile";
import { Notifications } from "./pages/Notifications";
import { Messages } from "./pages/Messages";
import { Settings } from "./pages/Settings";
import { Docs } from "./pages/Docs";

const INITIAL_DIRECTORY: DirectoryToken[] = SEEDED_TOKENS.map((s) => ({
  address: s.address.toLowerCase(),
  symbol: s.symbol,
  name: s.name,
  decimals: s.decimals,
  launchpad: s.launchpad,
  launchpadUrl: s.launchpadUrl,
  tagline: s.tagline,
  featured: s.featured,
  reserveWhype: 0,
  poolCount: 0,
  venues: [],
  priceHype: null,
  commentCount: 0,
  ratingAvg: 0,
  ratingCount: 0,
  bullishCount: 0,
  bearishCount: 0,
  bullishPct: 50,
}));

export function App(): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [directory, setDirectory] = useState<DirectoryToken[]>(INITIAL_DIRECTORY);
  const [hypeUsd, setHypeUsd] = useState<number>(38.5);
  const [unreadNotifications, setUnreadNotifications] = useState<number>(0);

  const refreshDirectory = () => {
    api
      .getTokens()
      .then((res) => {
        if (Array.isArray(res.tokens) && res.tokens.length > 0) {
          setDirectory(res.tokens);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    api
      .getMe()
      .then((res) => {
        setUser(res.user);
      })
      .catch(() => {});

    refreshDirectory();

    api
      .getHypePrice()
      .then((res) => {
        if (res.hypeUsd > 0) setHypeUsd(res.hypeUsd);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      setUnreadNotifications(0);
      return;
    }
    api
      .getNotifications()
      .then((res) => {
        setUnreadNotifications(res.unreadCount || 0);
      })
      .catch(() => {});
  }, [user?.id]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setUser(null);
    setUnreadNotifications(0);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Landing user={user} directory={directory} hypeUsd={hypeUsd} />
          }
        />
        <Route
          path="/auth"
          element={<AuthPage onAuthenticated={(u) => setUser(u)} />}
        />
        <Route path="/docs" element={<Docs />} />

        {/* App Shell Routes */}
        <Route
          path="/app"
          element={
            <Layout
              user={user}
              directory={directory}
              hypeUsd={hypeUsd}
              unreadNotifications={unreadNotifications}
              onLogout={handleLogout}
            >
              <Home
                user={user}
                directory={directory}
                hypeUsd={hypeUsd}
                onDirectoryRefresh={refreshDirectory}
              />
            </Layout>
          }
        />
        <Route
          path="/app/search"
          element={
            <Layout
              user={user}
              directory={directory}
              hypeUsd={hypeUsd}
              unreadNotifications={unreadNotifications}
              onLogout={handleLogout}
            >
              <Search user={user} directory={directory} />
            </Layout>
          }
        />
        <Route
          path="/app/token/:address"
          element={
            <Layout
              user={user}
              directory={directory}
              hypeUsd={hypeUsd}
              unreadNotifications={unreadNotifications}
              onLogout={handleLogout}
            >
              <Token user={user} directory={directory} hypeUsd={hypeUsd} />
            </Layout>
          }
        />
        <Route
          path="/app/post/:postId"
          element={
            <Layout
              user={user}
              directory={directory}
              hypeUsd={hypeUsd}
              unreadNotifications={unreadNotifications}
              onLogout={handleLogout}
            >
              <PostThread user={user} directory={directory} />
            </Layout>
          }
        />
        <Route
          path="/app/u/:username"
          element={
            <Layout
              user={user}
              directory={directory}
              hypeUsd={hypeUsd}
              unreadNotifications={unreadNotifications}
              onLogout={handleLogout}
            >
              <UserProfile viewer={user} directory={directory} />
            </Layout>
          }
        />
        <Route
          path="/app/notifications"
          element={
            <Layout
              user={user}
              directory={directory}
              hypeUsd={hypeUsd}
              unreadNotifications={unreadNotifications}
              onLogout={handleLogout}
            >
              <Notifications
                user={user}
                onMarkedRead={() => setUnreadNotifications(0)}
              />
            </Layout>
          }
        />
        <Route
          path="/app/messages"
          element={
            <Layout
              user={user}
              directory={directory}
              hypeUsd={hypeUsd}
              unreadNotifications={unreadNotifications}
              onLogout={handleLogout}
            >
              <Messages user={user} />
            </Layout>
          }
        />
        <Route
          path="/app/settings"
          element={
            <Layout
              user={user}
              directory={directory}
              hypeUsd={hypeUsd}
              unreadNotifications={unreadNotifications}
              onLogout={handleLogout}
            >
              <Settings
                user={user}
                onUserUpdated={(u) => setUser(u)}
                onLogout={handleLogout}
              />
            </Layout>
          }
        />
        <Route path="/app/docs" element={<Navigate to="/docs" replace />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
