// Folded into /notes (same store, filtered by kind=journal). This stub keeps
// any old bookmarks / linked URLs alive by sending them to the canonical surface.
import { redirect } from "next/navigation";

export default function JournalRedirect(): never {
  redirect("/notes");
}
