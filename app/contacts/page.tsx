// People surface removed at operator request 2026-06-12. Manual contact entry
// was never going to be a workflow Jensen used. Future surfacing of people
// will be implicit (via mail triage, conversation references, entity links),
// not a dedicated page.
//
// Old /contacts URLs redirect home to keep links alive without a 404.
import { redirect } from "next/navigation";

export default function ContactsRedirect(): never {
  redirect("/");
}
