import { redirect } from "next/navigation";

// Operator decision 2026-06-12: People surface removed completely.
// Contacts live implicitly in mail + meetings + brain_facts. A dedicated
// page added noise without earning its place. Route kept as a redirect so
// any old bookmarks land on Today instead of 404ing.
export default function Page() {
  redirect("/");
}
