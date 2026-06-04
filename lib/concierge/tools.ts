// Anthropic tool definitions for Rencontre. Every portal function is operable.
// READ tools run freely; WRITE tools mutate Supabase; SEND tools are gated.
// Keep descriptions tight (they ship in every request; cached).

type Tool = { name: string; description: string; input_schema: any };
const obj = (properties: any, required: string[] = []) => ({ type: "object", properties, required });
const str = (d: string) => ({ type: "string", description: d });
const num = (d: string) => ({ type: "number", description: d });
const bool = (d: string) => ({ type: "boolean", description: d });

export const TOOLS: Tool[] = [
  // ---- Portfolio ----
  { name: "list_entities", description: "List venues, clients, or events.", input_schema: obj({ kind: { type: "string", enum: ["venue", "client", "event"] }, status: str("filter by status text") }) },
  { name: "find_entity", description: "Find a venue/client/event by name.", input_schema: obj({ name: str("name to search") }, ["name"]) },
  { name: "create_entity", description: "Create a venue, client, or event.", input_schema: obj({ kind: { type: "string", enum: ["venue", "client", "event"] }, name: str("name"), subtitle: str("one-line subtitle"), status: str("status"), notes: str("notes") }, ["kind", "name"]) },
  { name: "update_entity", description: "Update a venue/client/event.", input_schema: obj({ id: str("entity id"), name: str(""), subtitle: str(""), status: str(""), notes: str("") }, ["id"]) },
  { name: "delete_entity", description: "Delete a venue/client/event.", input_schema: obj({ id: str("entity id") }, ["id"]) },

  // ---- Tasks ----
  { name: "list_tasks", description: "List tasks. Quadrant 1=urgent+important,2=important,3=urgent-only,4=noise.", input_schema: obj({ quadrant: num("1-4"), entityId: str(""), done: bool("") }) },
  { name: "create_task", description: "Add a task to the Covey board.", input_schema: obj({ title: str("task"), quadrant: num("1-4, default 2"), entityId: str("link to entity"), due: str("YYYY-MM-DD") }, ["title"]) },
  { name: "update_task", description: "Update a task (title/quadrant/due/done).", input_schema: obj({ id: str(""), title: str(""), quadrant: num(""), due: str(""), done: bool("") }, ["id"]) },
  { name: "complete_task", description: "Mark a task done.", input_schema: obj({ id: str("") }, ["id"]) },
  { name: "delete_task", description: "Delete a task.", input_schema: obj({ id: str("") }, ["id"]) },

  // ---- Calendar ----
  { name: "query_calendar", description: "List events in a date range (YYYY-MM-DD).", input_schema: obj({ from: str(""), to: str(""), entityId: str("") }) },
  { name: "create_event", description: "Add a calendar event.", input_schema: obj({ title: str(""), date: str("YYYY-MM-DD"), time: str("HH:MM"), entityId: str(""), note: str("") }, ["title", "date"]) },
  { name: "update_event", description: "Update an event.", input_schema: obj({ id: str(""), title: str(""), date: str(""), time: str(""), note: str("") }, ["id"]) },
  { name: "delete_event", description: "Delete an event.", input_schema: obj({ id: str("") }, ["id"]) },

  // ---- Finance (UAE) ----
  { name: "finance_summary", description: "Income, expense, net. Optionally per entity or period.", input_schema: obj({ entityId: str(""), from: str("YYYY-MM-DD"), to: str("YYYY-MM-DD") }) },
  { name: "list_finance", description: "List finance records.", input_schema: obj({ entityId: str(""), kind: { type: "string", enum: ["income", "expense"] } }) },
  { name: "record_finance", description: "Record an income or expense (AED, net).", input_schema: obj({ kind: { type: "string", enum: ["income", "expense"] }, amount: num("net AED"), vatApplies: bool("does 5% VAT apply"), label: str(""), date: str("YYYY-MM-DD"), entityId: str("") }, ["kind", "amount", "label"]) },
  { name: "update_finance", description: "Update a finance record.", input_schema: obj({ id: str(""), amount: num(""), label: str(""), vatApplies: bool(""), date: str("") }, ["id"]) },
  { name: "delete_finance", description: "Delete a finance record.", input_schema: obj({ id: str("") }, ["id"]) },
  { name: "vat_report", description: "UAE VAT (5%) output tax due for a period.", input_schema: obj({ from: str("YYYY-MM-DD"), to: str("YYYY-MM-DD") }) },
  { name: "ct_estimate", description: "UAE corporate tax (9% over AED 375k) estimate from net profit.", input_schema: obj({ from: str("YYYY-MM-DD"), to: str("YYYY-MM-DD") }) },

  // ---- Documents / brain ----
  { name: "search_documents", description: "Semantic+keyword search of filed documents.", input_schema: obj({ query: str(""), folder: str(""), entityId: str("") }, ["query"]) },
  { name: "list_documents", description: "List filed documents by folder/entity.", input_schema: obj({ folder: str("finance|legal|identity|contracts|clients|venues|events|menus|branding|reports|general"), entityId: str("") }) },
  { name: "file_document", description: "Move/assign a document to a folder and entity.", input_schema: obj({ id: str(""), folder: str(""), entityId: str(""), sensitivity: { type: "string", enum: ["normal", "restricted"] } }, ["id", "folder"]) },
  { name: "delete_document", description: "Delete a filed document.", input_schema: obj({ id: str("") }, ["id"]) },

  // ---- Generation ----
  { name: "generate_document", description: "Draft a branded business document (proposal/SOP/menu/cost model/report/letter).", input_schema: obj({ type: { type: "string", enum: ["proposal", "sop", "menu", "cost_model", "report", "letter"] }, brief: str("what it should contain"), entityId: str("") }, ["type", "brief"]) },
  { name: "generate_legal", description: "Draft a legal document grounded on Jensen's legal blueprint.", input_schema: obj({ type: { type: "string", enum: ["nda", "service", "consultancy", "engagement", "letter"] }, brief: str("parties, scope, terms") }, ["type", "brief"]) },
  { name: "set_legal_blueprint", description: "Save/replace Jensen's standing legal blueprint.", input_schema: obj({ text: str("") }, ["text"]) },

  // ---- Contacts ----
  { name: "list_contacts", description: "List contacts.", input_schema: obj({}) },
  { name: "find_contact", description: "Find a contact by name or company.", input_schema: obj({ query: str("") }, ["query"]) },
  { name: "add_contact", description: "Add a contact.", input_schema: obj({ name: str(""), company: str(""), role: str(""), email: str(""), phone: str(""), entityId: str("") }, ["name"]) },
  { name: "update_contact", description: "Update a contact.", input_schema: obj({ id: str(""), name: str(""), company: str(""), role: str(""), email: str(""), phone: str("") }, ["id"]) },
  { name: "delete_contact", description: "Delete a contact.", input_schema: obj({ id: str("") }, ["id"]) },

  // ---- Notes ----
  { name: "list_notes", description: "List notes/ideas/links/journal.", input_schema: obj({ kind: { type: "string", enum: ["note", "idea", "link", "journal"] } }) },
  { name: "add_note", description: "Capture a note, idea, link, or journal entry.", input_schema: obj({ kind: { type: "string", enum: ["note", "idea", "link", "journal"] }, title: str(""), body: str(""), url: str(""), entityId: str("") }, ["body"]) },
  { name: "delete_note", description: "Delete a note.", input_schema: obj({ id: str("") }, ["id"]) },

  // ---- Mail (read freely; sending is gated) ----
  { name: "draft_reply", description: "Draft a reply to an email (NOT sent; queued for Jensen to approve).", input_schema: obj({ to: str(""), subject: str(""), intent: str("what to say") }, ["intent"]) },

  // ---- Memory / brain ----
  { name: "remember_fact", description: "Store a durable fact about Jensen's world for long-term memory.", input_schema: obj({ fact: str(""), subject: str("who/what it is about") }, ["fact"]) },
  { name: "query_memory", description: "Recall what you know about a person, venue, client, or topic.", input_schema: obj({ about: str("") }, ["about"]) },

  // ---- Brief / proactive ----
  { name: "morning_brief", description: "Compose the cleared-board brief: what's done, what's queued (Q1), what's protected (Q2). Uses Dubai time.", input_schema: obj({}) },

  // ---- Settings / goals ----
  { name: "get_settings", description: "Read Jensen's preferences and goals.", input_schema: obj({}) },
  { name: "update_prefs", description: "Update working preferences (style/tone/hours), and the onboarding gate. Admin only: set onboarding=false to ACTIVATE the bot for Jensen (end listen-only onboarding); onboarding=true returns him to onboarding.", input_schema: obj({ workStyle: str(""), tone: str(""), hours: str(""), extra: str(""), onboarding: bool("false = activate bot for Jensen; true = listen-only onboarding") }) },
  { name: "set_goals", description: "Set Jensen's goals list.", input_schema: obj({ goals: { type: "array", items: { type: "string" } } }, ["goals"]) },

  // ---- Store ----
  { name: "store_summary", description: "Live Upaya Shopify data: order count, revenue, and recent orders with customer, items, fulfillment status and tracking. Use for any question about orders, sales, revenue, customers, or deliveries.", input_schema: obj({}) },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
// Tools whose ok=true is required to back a "done/saved/sent" claim (verifier).
export const COMPLETION_TOOLS = new Set([
  "create_entity", "update_entity", "delete_entity", "create_task", "update_task", "complete_task", "delete_task",
  "create_event", "update_event", "delete_event", "record_finance", "update_finance", "delete_finance",
  "file_document", "delete_document", "generate_document", "generate_legal", "set_legal_blueprint",
  "add_contact", "update_contact", "delete_contact", "add_note", "delete_note", "remember_fact",
  "update_prefs", "set_goals",
]);
