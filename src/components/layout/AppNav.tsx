import AppNavClient from "@/components/layout/AppNavClient";
import { getViewer, firstName } from "@/lib/auth/session";

/**
 * The product header, as every app surface imports it.
 *
 * A server component wrapping the interactive one purely so the session read
 * happens in one place. The alternative — every page fetching the viewer and
 * threading it down — is five identical edits and a sixth one forgotten later.
 * `getViewer` is request-cached, so a page that also needs the viewer for its
 * own reasons does not pay for it twice.
 */
export default async function AppNav() {
  const viewer = await getViewer();

  return (
    <AppNavClient
      viewer={viewer ? { name: firstName(viewer), role: viewer.role } : null}
    />
  );
}
