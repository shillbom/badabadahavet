import Layout from "@/components/Layout";

/**
 * The authed-app route group. Everything in `(app)` renders inside the app
 * chrome (top bar, content column, FAB, bottom nav) — see
 * `src/components/Layout.tsx`, which used to be mounted as a react-router
 * pathless <Route element={<Layout />}>.
 *
 * `/login` and `/auth/google` sit OUTSIDE this group on purpose: they were
 * outside <Layout /> in the old route table too, and they get only the
 * app-wide shell from the root layout (app/AppBoot.tsx).
 */
export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Layout>{children}</Layout>;
}
