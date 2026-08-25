import {
  BarChart3,
  Bot,
  Building2,
  CalendarDays,
  Contact,
  Gauge,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Radar,
  ScrollText,
  Settings,
  Users
} from "lucide-react";
import type { NavItem } from "@/types/navigation";

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard, phase: "ready" },
  { label: "Companies", href: "/app/companies", icon: Building2, phase: "ready" },
  { label: "Discovery", href: "/app/discovery", icon: Radar, phase: "ready" },
  { label: "Contacts", href: "/app/contacts", icon: Contact, phase: "ready" },
  { label: "Campaigns", href: "/app/campaigns", icon: Megaphone, phase: "placeholder" },
  { label: "AI Research Queue", href: "/app/research", icon: Bot, phase: "ready" },
  { label: "Outreach", href: "/app/outreach", icon: Inbox, phase: "ready" },
  { label: "Meetings", href: "/app/meetings", icon: Users, phase: "ready" },
  { label: "Calendar", href: "/app/calendar", icon: CalendarDays, phase: "placeholder" },
  { label: "Analytics", href: "/app/analytics", icon: BarChart3, phase: "placeholder" },
  { label: "Settings", href: "/app/settings", icon: Settings, phase: "ready" },
  { label: "Logs", href: "/app/logs", icon: ScrollText, phase: "ready" }
];

export const dashboardMetrics = [
  { label: "Total companies", key: "totalCompanies", icon: Building2 },
  { label: "Researched", key: "researchedCompanies", icon: Bot },
  { label: "Qualified leads", key: "qualifiedLeads", icon: Gauge },
  { label: "Approved leads", key: "approvedLeads", icon: Users },
  { label: "Contacted", key: "contactedLeads", icon: Inbox },
  { label: "Replies", key: "replies", icon: Megaphone },
  { label: "Meetings booked", key: "meetingsBooked", icon: CalendarDays },
  { label: "Estimated AI cost", key: "estimatedAiCost", icon: BarChart3 }
] as const;
