import {
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarCheck,
  Contact,
  Download,
  FlaskConical,
  Home,
  Inbox,
  MailCheck,
  ScrollText,
  Send,
  Settings,
  Target
} from "lucide-react";
import type { NavItem } from "@/types/navigation";

/**
 * Primary navigation: the surfaces a business owner needs.
 * Everything operational lives under Advanced so the product reads as an SDR,
 * not as an admin console. Brain (the live view of every agent) was promoted
 * from Advanced at the owner's request on 2026-11-10: it is how they watch the
 * SDR work, not a debugging tool.
 */
export const primaryNavItems: NavItem[] = [
  { label: "Home", href: "/app/home", icon: Home, phase: "ready" },
  { label: "Brain", href: "/app/brain", icon: BrainCircuit, phase: "ready" },
  { label: "Campaigns", href: "/app/campaigns", icon: Target, phase: "ready" },
  { label: "Inbox", href: "/app/inbox", icon: Inbox, phase: "ready" },
  { label: "Meetings", href: "/app/meetings", icon: CalendarCheck, phase: "ready" }
];

/**
 * Always shown, whatever the autonomy setting.
 *
 * Autonomy governs *email*. The direct-message and contact-form channels always
 * produce a draft a person must send or submit, because neither can be put on
 * the wire unattended. Hiding this queue outside "Draft only" therefore stripped
 * those drafts from the interface entirely - they were written, queued, and
 * never seen. It also meant that any moment the business record had not loaded,
 * the app told the owner their SDR was sending without asking, which was not
 * true and is not a claim to make from missing data.
 */
export const approvalsNavItem: NavItem = {
  label: "Approvals",
  href: "/app/approvals",
  icon: MailCheck,
  phase: "ready"
};

export const settingsNavItem: NavItem = {
  label: "Settings",
  href: "/app/settings",
  icon: Settings,
  phase: "ready"
};

export const advancedNavItem: NavItem = {
  label: "Advanced",
  href: "/app/advanced",
  icon: FlaskConical,
  phase: "ready"
};

/**
 * Operational tooling preserved for power users and debugging. These pages are
 * unchanged; they are simply no longer part of the primary experience.
 */
export const advancedNavItems: Array<NavItem & { description: string; group: string }> = [
  {
    label: "Companies",
    href: "/app/companies",
    icon: Building2,
    phase: "ready",
    group: "Data & operations",
    description: "Every company your SDR has found, with raw records and filters."
  },
  {
    label: "Contacts",
    href: "/app/contacts",
    icon: Contact,
    phase: "ready",
    group: "Data & operations",
    description: "Every person found, with verification status and source."
  },
  {
    label: "Research",
    href: "/app/research",
    icon: FlaskConical,
    phase: "ready",
    group: "Data & operations",
    description: "The research queue and per-company AI research output."
  },
  {
    label: "Emails",
    href: "/app/outreach",
    icon: Send,
    phase: "ready",
    group: "Data & operations",
    description: "Draft, approve, edit and export individual emails."
  },
  {
    label: "Campaign builder",
    href: "/app/discovery",
    icon: Target,
    phase: "ready",
    group: "Data & operations",
    description: "Full targeting configuration, runs and rejected companies."
  },
  {
    label: "Imports",
    href: "/app/import",
    icon: Download,
    phase: "ready",
    group: "Data & operations",
    description: "Bring your own list of companies in from a CSV file."
  },
  {
    label: "Analytics",
    href: "/app/analytics",
    icon: BarChart3,
    phase: "ready",
    group: "Diagnostics",
    description: "Conversion rates by signal, angle, persona and campaign."
  },
  {
    label: "System logs",
    href: "/app/logs",
    icon: ScrollText,
    phase: "ready",
    group: "Diagnostics",
    description: "Raw technical event log for debugging."
  }
];

/** Stage labels for the campaign journey, in order. */
export const journeyStages = [
  { key: "found", label: "Finding", description: "Companies found" },
  { key: "qualified", label: "Qualifying", description: "Good opportunities" },
  { key: "peopleFound", label: "Finding people", description: "People found" },
  { key: "contacted", label: "Contacting", description: "Contacted" },
  { key: "replies", label: "Conversations", description: "Replies" },
  { key: "meetings", label: "Meetings", description: "Meetings booked" }
] as const;
