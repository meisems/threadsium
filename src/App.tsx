import React, { Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Loom } from "./components/brand";
import { Shell } from "./components/Shell";
import { Home } from "./pages/Home";
import { Landing } from "./pages/Landing";
import { AppProvider } from "./state";

// The feed and landing page load first; everything else arrives when it is opened.
const Auth = React.lazy(() => import("./pages/Auth").then((m) => ({ default: m.Auth })));
const Docs = React.lazy(() => import("./pages/Docs").then((m) => ({ default: m.Docs })));
const Rooms = React.lazy(() => import("./pages/Rooms").then((m) => ({ default: m.Rooms })));
const Room = React.lazy(() => import("./pages/Room").then((m) => ({ default: m.Room })));
const EmbedRoom = React.lazy(() => import("./pages/EmbedRoom").then((m) => ({ default: m.EmbedRoom })));
const PostThread = React.lazy(() => import("./pages/PostThread").then((m) => ({ default: m.PostThread })));
const Profile = React.lazy(() => import("./pages/Profile").then((m) => ({ default: m.Profile })));
const Search = React.lazy(() => import("./pages/Search").then((m) => ({ default: m.Search })));
const Settings = React.lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Notifications = React.lazy(() => import("./pages/Inbox").then((m) => ({ default: m.Notifications })));
const Messages = React.lazy(() => import("./pages/Inbox").then((m) => ({ default: m.Messages })));
const Saved = React.lazy(() => import("./pages/Inbox").then((m) => ({ default: m.Saved })));

const wait = <Loom label="Loading the page" />;
const page = (el: React.ReactElement) => <Suspense fallback={wait}>{el}</Suspense>;

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={page(<Auth />)} />
          <Route path="/docs" element={page(<Docs />)} />
          <Route path="/embed/room/:address" element={page(<EmbedRoom />)} />
          <Route path="/embed/token/:address" element={page(<EmbedRoom />)} />
          <Route path="/app" element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="rooms" element={page(<Rooms />)} />
            <Route path="token/:address" element={page(<Room />)} />
            <Route path="post/:postId" element={page(<PostThread />)} />
            <Route path="u/:username" element={page(<Profile />)} />
            <Route path="search" element={page(<Search />)} />
            <Route path="notifications" element={page(<Notifications />)} />
            <Route path="messages" element={page(<Messages />)} />
            <Route path="messages/:username" element={page(<Messages />)} />
            <Route path="saved" element={page(<Saved />)} />
            <Route path="settings" element={page(<Settings />)} />
            <Route path="docs" element={<Navigate to="/docs" replace />} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}
