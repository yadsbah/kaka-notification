import {
  AppstoreOutlined,
  AuditOutlined,
  DashboardOutlined,
  NotificationOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Authenticated, Refine } from "@refinedev/core";
import { AuthPage, ErrorComponent, RefineThemes, ThemedLayout, ThemedTitle, useNotificationProvider } from "@refinedev/antd";
import routerProvider, { CatchAllNavigate, NavigateToResource } from "@refinedev/react-router";
import { App as AntdApp, ConfigProvider, theme } from "antd";
import "@refinedev/antd/dist/reset.css";
import { useEffect, useState } from "react";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";
import { AdminsList } from "./pages/admins/list";
import { AuditList } from "./pages/audit/list";
import { JobsList } from "./pages/jobs/list";
import { NotificationCreate } from "./pages/notifications/create";
import { NotificationsList } from "./pages/notifications/list";
import { NotificationShow } from "./pages/notifications/show";
import { Overview } from "./pages/overview";
import { ProjectCreate, ProjectEdit } from "./pages/projects/form";
import { ProjectsList } from "./pages/projects/list";
import { ProjectShow } from "./pages/projects/show";
import { authProvider } from "./providers/authProvider";
import { dataProvider } from "./providers/dataProvider";

const Title = ({ collapsed }: { collapsed: boolean }) => (
  <ThemedTitle collapsed={collapsed} text="Notification Manager" icon={<NotificationOutlined />} />
);

const usePrefersDark = () => {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const listener = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [query]);
  return dark;
};

export default function App() {
  const dark = usePrefersDark();
  return (
    <BrowserRouter>
      <ConfigProvider theme={{ ...RefineThemes.Blue, algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
        <AntdApp>
          <Refine
            dataProvider={dataProvider}
            authProvider={authProvider}
            routerProvider={routerProvider}
            notificationProvider={useNotificationProvider}
            resources={[
              { name: "overview", list: "/", meta: { label: "Overview", icon: <DashboardOutlined /> } },
              {
                name: "projects",
                list: "/projects",
                create: "/projects/create",
                edit: "/projects/:id/edit",
                show: "/projects/:id",
                meta: { icon: <AppstoreOutlined />, canDelete: true },
              },
              {
                name: "notifications",
                list: "/notifications",
                create: "/notifications/create",
                show: "/notifications/:id",
                meta: { icon: <NotificationOutlined /> },
              },
              { name: "jobs", list: "/jobs", meta: { label: "Jobs / Queue", icon: <UnorderedListOutlined /> } },
              { name: "admins", list: "/admins", meta: { label: "Admins", icon: <TeamOutlined />, canDelete: true } },
              { name: "audit", list: "/audit", meta: { label: "Audit log", icon: <AuditOutlined /> } },
            ]}
            options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, disableTelemetry: true }}
          >
            <Routes>
              <Route
                element={
                  <Authenticated key="app" fallback={<CatchAllNavigate to="/login" />}>
                    <ThemedLayout Title={Title}>
                      <Outlet />
                    </ThemedLayout>
                  </Authenticated>
                }
              >
                <Route index element={<Overview />} />
                <Route path="/projects">
                  <Route index element={<ProjectsList />} />
                  <Route path="create" element={<ProjectCreate />} />
                  <Route path=":id" element={<ProjectShow />} />
                  <Route path=":id/edit" element={<ProjectEdit />} />
                </Route>
                <Route path="/notifications">
                  <Route index element={<NotificationsList />} />
                  <Route path="create" element={<NotificationCreate />} />
                  <Route path=":id" element={<NotificationShow />} />
                </Route>
                <Route path="/jobs" element={<JobsList />} />
                <Route path="/admins" element={<AdminsList />} />
                <Route path="/audit" element={<AuditList />} />
                <Route path="*" element={<ErrorComponent />} />
              </Route>
              <Route
                element={
                  <Authenticated key="auth" fallback={<Outlet />}>
                    <NavigateToResource resource="overview" />
                  </Authenticated>
                }
              >
                <Route
                  path="/login"
                  element={
                    <AuthPage
                      type="login"
                      title={<Title collapsed={false} />}
                      rememberMe={false}
                      forgotPasswordLink={false}
                      registerLink={false}
                      formProps={{ initialValues: {} }}
                    />
                  }
                />
              </Route>
            </Routes>
          </Refine>
        </AntdApp>
      </ConfigProvider>
    </BrowserRouter>
  );
}
