// lib/capabilities.js
export function capabilitiesFromScopes(scopes = []) {
  const has = (s) => scopes.includes(s);

  // Aggregates (some portals expose "files" or "tickets" instead of granular R/W)
  const filesRW   = has("files") || has("files.write") || has("files.ui_hidden.write");
  const filesR    = has("files") || has("files.read");
  const ticketsRW = has("tickets") || (has("tickets.read") && has("tickets.write"));

  const caps = {
    // Conversations
    conversationsRead: has("conversations.read"),
    conversationsWrite: has("conversations.write"),

    // Files
    filesRead: filesR,
    filesWrite: filesRW,

    // Tickets
    ticketsRead:  ticketsRW || has("tickets.read"),
    ticketsWrite: ticketsRW || has("tickets.write"),

    // CRM objects
    contactsRead:   has("crm.objects.contacts.read"),
    companiesRead:  has("crm.objects.companies.read"),
    productsRead:   has("crm.objects.products.read"),
    dealsRead:      has("crm.objects.deals.read"),
    dealsWrite:     has("crm.objects.deals.write"),
    lineItemsRead:  has("crm.objects.line_items.read"),
    lineItemsWrite: has("crm.objects.line_items.write"),
    quotesRead:     has("crm.objects.quotes.read"),
    quotesWrite:    has("crm.objects.quotes.write"),

    // Optional writes (often missing on smaller plans)
    tasksWrite:        has("crm.objects.tasks.write"),
    notesWrite:        has("crm.objects.notes.write"),
    customSchemaWrite: has("crm.schemas.custom.write"),
  };

  // Quoting mode from scopes alone
  caps.quotingMode =
    (caps.quotesRead && caps.quotesWrite && caps.productsRead &&
     caps.lineItemsRead && caps.lineItemsWrite && caps.dealsWrite)
      ? "native"
      : (caps.filesWrite ? "pdf" : "text-only");

  return caps;
}
