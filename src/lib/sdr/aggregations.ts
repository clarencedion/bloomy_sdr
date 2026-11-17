/**
 * Aggregation helpers for the simplified SDR surfaces.
 *
 * Every number rendered by Home, Campaigns, Inbox and Meetings comes from here,
 * so React components stay presentational and business logic lives in one
 * place. All reads are scoped by workspace (and business where the documents
 * carry one) to preserve tenant isolation.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  where,
  type Query,
  type QueryConstraint
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { cachedRead } from "./query-cache";
import { collections } from "@/lib/firebase/firestore";
import type { Company, ConversationDoc, DiscoveryCampaign, Log, Outreach } from "@/types/firestore";
import { humanizeActivityFeed, toDate, type HumanActivityEvent } from "./activity-humanizer";
import { awaitsSessionSend, channelOf, networkLabel } from "./channel";
import { describeOpportunity, type OpportunitySummary } from "./opportunity-language";

export interface Scope {
  workspaceId: string;
  businessId?: string;
  campaignId?: string;
}

/** Journey stages shown to the user, in order. */
export interface CampaignFunnel {
  found: number;
  qualified: number;
  peopleFound: number;
  contacted: number;
  replies: number;
  meetings: number;
}

export interface CampaignOverview {
  campaign: DiscoveryCampaign | null;
  funnel: CampaignFunnel;
  /** Companies worth showing on the campaign page, best first. */
  bestProspects: BestProspect[];
  activity: HumanActivityEvent[];
}

export interface BestProspect {
  company: Company;
  opportunity: OpportunitySummary | null;
  /** Plain-language status, e.g. "Contacted", "Replied". */
  status: string;
}

export interface AttentionItem {
  conversation: ConversationDoc;
  companyName: string;
  /** Why this needs a human, in plain language. */
  reason: string;
}

export interface HomeSummary {
  activeCampaigns: number;
  totalCampaigns: number;
  funnel: CampaignFunnel;
  needsAttention: number;
  upcomingMeetings: number;
}

// ── Shared helpers ──────────────────────────────────────────

function scopedQuery(path: string, scope: Scope, extra: QueryConstraint[] = []): Query {
  const constraints: QueryConstraint[] = [where("workspaceId", "==", scope.workspaceId), ...extra];
  return query(collection(db, path), ...constraints);
}

async function fetchAll<T>(q: Query): Promise<T[]> {
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as T[];
}

/**
 * A whole-collection read, de-duplicated across the screen.
 *
 * Firestore bills per document returned, so the same collection fetched by four
 * aggregations on one page costs four times over. The key must describe the
 * data, not the caller — that is what lets separate callers share one read.
 */
function fetchScoped<T>(path: string, scope: Scope, extra: QueryConstraint[] = [], keySuffix = ""): Promise<T[]> {
  const key = `scoped:${path}:${scope.workspaceId}${keySuffix}`;
  return cachedRead(key, () => fetchAll<T>(scopedQuery(path, scope, extra)));
}

/**
 * Documents written before multi-business scoping, or by jobs that only set
 * `workspaceId`, must not silently vanish from the UI. A document matches when
 * it carries the business explicitly or carries none at all.
 */
function matchesBusiness(doc: { businessId?: string }, businessId?: string): boolean {
  if (!businessId) return true;
  return !doc.businessId || doc.businessId === businessId;
}

function matchesCampaign(company: Company, campaignId?: string): boolean {
  if (!campaignId) return true;
  return company.discoveryCampaignId === campaignId;
}

/** Companies that reached or passed a given pipeline stage. */
const CONTACTED_STATUSES = new Set(["contacted", "replied", "meeting_booked", "won"]);
const REPLIED_STATUSES = new Set(["replied", "meeting_booked", "won"]);

const STATUS_LABELS: Record<string, string> = {
  imported: "New",
  discovered: "Found",
  enrichment_pending: "Being checked",
  enriching: "Being checked",
  enriched: "Checked",
  research_pending: "Being researched",
  researching: "Being researched",
  researched: "Researched",
  outreach_ready: "Ready to contact",
  qualified: "Good opportunity",
  approved: "Ready to contact",
  contacted: "Contacted",
  replied: "Replied",
  meeting_booked: "Meeting booked",
  won: "Won"
};

export function statusLabel(status: string | undefined): string {
  if (!status) return "New";
  return STATUS_LABELS[status] ?? "In progress";
}

// ── Campaigns ───────────────────────────────────────────────

export async function listCampaigns(scope: Scope): Promise<DiscoveryCampaign[]> {
  // Scope in the query, not after it: an unfiltered window would let another
  // workspace's campaigns push this one's out of the result set.
  const campaigns = await fetchAll<DiscoveryCampaign>(
    query(
      collection(db, collections.discoveryCampaigns),
      where("workspaceId", "==", scope.workspaceId),
      orderBy("updatedAt", "desc"),
      fbLimit(100)
    )
  ).catch(() =>
    fetchAll<DiscoveryCampaign>(
      query(collection(db, collections.discoveryCampaigns), where("workspaceId", "==", scope.workspaceId))
    ).catch(() => [] as DiscoveryCampaign[])
  );

  return campaigns
    .filter((campaign) => matchesBusiness(campaign, scope.businessId))
    .sort((a, b) => (toDate(b.updatedAt)?.getTime() ?? 0) - (toDate(a.updatedAt)?.getTime() ?? 0));
}

/**
 * Reads one campaign by id. Fetching the document directly means a campaign
 * outside the recent-campaigns window still opens correctly - including the one
 * the user is redirected to immediately after starting it.
 */
export async function getCampaign(campaignId: string, scope: Scope): Promise<DiscoveryCampaign | null> {
  const snapshot = await getDoc(doc(db, collections.discoveryCampaigns, campaignId));
  if (!snapshot.exists()) return null;

  const campaign = { id: snapshot.id, ...snapshot.data() } as DiscoveryCampaign;
  if (campaign.workspaceId && campaign.workspaceId !== scope.workspaceId) return null;
  if (!matchesBusiness(campaign, scope.businessId)) return null;
  return campaign;
}

/**
 * Computes the journey counts for a scope.
 *
 * Each stage counts DISTINCT COMPANIES that reached *at least* that stage, so
 * the funnel is monotonic: a company that booked a meeting is still counted as
 * qualified and contacted even though its single `status` field has since moved
 * past those values. Without this, the campaign page could show more companies
 * contacted than were ever qualified.
 */
export function computeFunnel(input: {
  companies: Company[];
  outreach: Outreach[];
  conversations: ConversationDoc[];
  meetings: Array<{ companyId?: string; status?: string }>;
}): CampaignFunnel {
  const { companies, outreach, conversations, meetings } = input;
  const known = new Set(companies.map((company) => company.id));

  // Stage 6 — a meeting exists.
  const meetingSet = new Set<string>();
  for (const meeting of meetings) {
    if (meeting.status === "cancelled") continue;
    if (meeting.companyId && known.has(meeting.companyId)) meetingSet.add(meeting.companyId);
  }
  for (const company of companies) {
    if (company.status === "meeting_booked" || company.status === "won") meetingSet.add(company.id);
  }

  // Stage 5 — they replied.
  const repliedSet = new Set(meetingSet);
  for (const company of companies) {
    if (REPLIED_STATUSES.has(company.status)) repliedSet.add(company.id);
  }
  for (const item of outreach) {
    if (item.status === "replied" && known.has(item.companyId)) repliedSet.add(item.companyId);
  }
  for (const conversation of conversations) {
    if (!known.has(conversation.companyId)) continue;
    if (conversation.messageCount > 1 || conversation.status === "in_dialogue") {
      repliedSet.add(conversation.companyId);
    }
  }

  // Stage 4 — we emailed them.
  const contactedSet = new Set(repliedSet);
  for (const company of companies) {
    if (CONTACTED_STATUSES.has(company.status)) contactedSet.add(company.id);
  }
  for (const item of outreach) {
    if ((item.status === "sent" || item.status === "replied") && known.has(item.companyId)) {
      contactedSet.add(item.companyId);
    }
  }

  // Contact details are extracted during enrichment, which can run before
  // scoring. A company the engine then ruled out is not "someone to talk to"
  // and not a "good opportunity", so it is excluded from both stages - unless
  // it was actually contacted, in which case the earlier stages must still
  // account for it.
  const isDisqualified = (company: Company) =>
    (company.opportunityScore?.qualificationState ?? company.qualificationState) === "DISQUALIFIED";

  // Stage 3 — we found someone to talk to.
  const peopleSet = new Set(contactedSet);
  for (const company of companies) {
    if (isDisqualified(company)) continue;
    if ((company.extractedEmailCount ?? 0) > 0 || company.leadReadyForOutreach === true) {
      peopleSet.add(company.id);
    }
  }

  // Stage 2 — the opportunity looks worth pursuing.
  const qualifiedSet = new Set(peopleSet);
  for (const company of companies) {
    const state = company.opportunityScore?.qualificationState ?? company.qualificationState;
    if (state === "QUALIFIED" || state === "HIGH_PRIORITY") qualifiedSet.add(company.id);
    else if (!state && company.status === "qualified") qualifiedSet.add(company.id);
  }

  return {
    found: companies.length,
    qualified: qualifiedSet.size,
    peopleFound: peopleSet.size,
    contacted: contactedSet.size,
    replies: repliedSet.size,
    meetings: meetingSet.size
  };
}

/** Ranks companies by opportunity score so the campaign page shows real wins. */
export function rankProspects(companies: Company[], max = 6): BestProspect[] {
  return [...companies]
    .filter((company) => company.opportunityScore || typeof company.discoveryScore === "number")
    .sort((a, b) => {
      const scoreA = a.opportunityScore?.overallScore ?? a.discoveryScore ?? 0;
      const scoreB = b.opportunityScore?.overallScore ?? b.discoveryScore ?? 0;
      return scoreB - scoreA;
    })
    .slice(0, max)
    .map((company) => ({
      company,
      opportunity: describeOpportunity(company.opportunityScore),
      status: statusLabel(company.status)
    }));
}

async function loadScopeData(scope: Scope) {
  const [companiesRaw, outreachRaw, conversationsRaw, meetingsRaw] = await Promise.all([
    fetchScoped<Company>(collections.companies, scope),
    fetchScoped<Outreach>(collections.outreach, scope),
    fetchScoped<ConversationDoc>(collections.conversations, scope),
    fetchScoped<{ id: string; workspaceId?: string; businessId?: string; companyId?: string; status?: string; startTime?: unknown }>(
      "meetings",
      scope
    )
  ]);

  const companies = companiesRaw
    .filter((company) => matchesBusiness(company, scope.businessId))
    .filter((company) => matchesCampaign(company, scope.campaignId));

  const companyIds = new Set(companies.map((company) => company.id));
  const restrictToScope = <T extends { businessId?: string; companyId?: string }>(items: T[]) =>
    items
      .filter((item) => matchesBusiness(item, scope.businessId))
      .filter((item) => !scope.campaignId || (item.companyId ? companyIds.has(item.companyId) : false));

  return {
    companies,
    outreach: restrictToScope(outreachRaw),
    conversations: restrictToScope(conversationsRaw),
    meetings: restrictToScope(meetingsRaw)
  };
}

export async function getCampaignFunnel(scope: Scope): Promise<CampaignFunnel> {
  const { companies, outreach, conversations, meetings } = await loadScopeData(scope);
  return computeFunnel({ companies, outreach, conversations, meetings });
}

export async function getCampaignOverview(campaignId: string, scope: Scope): Promise<CampaignOverview> {
  const campaignScope: Scope = { ...scope, campaignId };
  const [campaign, data, activity] = await Promise.all([
    getCampaign(campaignId, scope),
    loadScopeData(campaignScope),
    getAgentActivity(scope, 40)
  ]);

  // Events about this campaign's companies, plus campaign-level events that
  // name this campaign explicitly (for example "Searched for new companies",
  // which is the only signal a brand-new campaign has). Events belonging to
  // neither are another campaign's and must not bleed across pages.
  const companyIds = new Set(data.companies.map((company) => company.id));
  const campaignActivity = activity.filter((event) => {
    if (event.companyId) return companyIds.has(event.companyId);
    return event.campaignId === campaignId;
  });

  return {
    campaign,
    funnel: computeFunnel({
      companies: data.companies,
      outreach: data.outreach,
      conversations: data.conversations,
      meetings: data.meetings
    }),
    bestProspects: rankProspects(data.companies),
    activity: campaignActivity.slice(0, 20)
  };
}

/**
 * Journey counts for many campaigns in one pass over the workspace, so the
 * campaign list does not issue a query per campaign.
 */
export async function getCampaignFunnels(
  scope: Scope,
  campaigns: DiscoveryCampaign[]
): Promise<Map<string, CampaignFunnel>> {
  const data = await loadScopeData(scope);
  const result = new Map<string, CampaignFunnel>();

  for (const campaign of campaigns) {
    const companies = data.companies.filter((company) => company.discoveryCampaignId === campaign.id);
    const ids = new Set(companies.map((company) => company.id));

    result.set(
      campaign.id,
      computeFunnel({
        companies,
        outreach: data.outreach.filter((item) => ids.has(item.companyId)),
        conversations: data.conversations.filter((item) => ids.has(item.companyId)),
        meetings: data.meetings.filter((item) => item.companyId && ids.has(item.companyId))
      })
    );
  }

  return result;
}

// ── Home ────────────────────────────────────────────────────

export async function getHomeSummary(scope: Scope, now = new Date()): Promise<HomeSummary> {
  // One pass over the workspace. Calling the individual helpers here would
  // re-read companies three times and conversations twice per page load.
  const [campaigns, data] = await Promise.all([listCampaigns(scope), loadScopeData(scope)]);

  const upcomingMeetings = data.meetings.filter((meeting) => {
    if (meeting.status === "cancelled") return false;
    const start = toDate((meeting as { startTime?: unknown }).startTime);
    return start !== null && start.getTime() >= now.getTime();
  }).length;

  return {
    activeCampaigns: campaigns.filter((campaign) => campaign.status === "active").length,
    totalCampaigns: campaigns.filter((campaign) => campaign.status !== "archived").length,
    funnel: computeFunnel({
      companies: data.companies,
      outreach: data.outreach,
      conversations: data.conversations,
      meetings: data.meetings
    }),
    needsAttention: data.conversations.filter(requiresHumanAttention).length,
    upcomingMeetings
  };
}

// ── Activity ────────────────────────────────────────────────

/**
 * Recent SDR activity in plain language. Company names are resolved from the
 * `companies` collection because logs only carry IDs.
 */
export async function getAgentActivity(scope: Scope, max = 25): Promise<HumanActivityEvent[]> {
  const window = Math.max(max * 4, 100);

  const [logs, companies] = await Promise.all([
    fetchAll<Log>(
      query(
        collection(db, collections.logs),
        where("workspaceId", "==", scope.workspaceId),
        orderBy("createdAt", "desc"),
        fbLimit(window)
      )
    ).catch(() =>
      // Legacy logs predate workspace stamping. Fall back to the most recent
      // logs ordered by time (a single-field index, always available) and let
      // the ownership filter below decide what may be shown. Never widen the
      // read into an unscoped dump.
      fetchAll<Log>(query(collection(db, collections.logs), orderBy("createdAt", "desc"), fbLimit(window))).catch(
        () => [] as Log[]
      )
    ),
    fetchScoped<Company>(collections.companies, scope)
  ]);

  // Scope the company set by business too: `scopedQuery` only constrains the
  // workspace, so without this the companyId path below would admit logs about
  // another business's companies.
  const scopedCompanies = companies.filter((company) => matchesBusiness(company, scope.businessId));
  const names = new Map(scopedCompanies.map((company) => [company.id, company.name]));
  const ownedCompanyIds = new Set(scopedCompanies.map((company) => company.id));

  /**
   * A log belongs to this scope when it is stamped with the workspace, or when
   * it is about a company this scope owns. Anything else is another tenant's
   * event and is dropped rather than rendered.
   */
  const belongsToScope = (log: Log): boolean => {
    const companyId = typeof log.metadata?.companyId === "string" ? log.metadata.companyId : undefined;
    if (companyId) return ownedCompanyIds.has(companyId);
    if (!log.workspaceId) return false;
    return log.workspaceId === scope.workspaceId && matchesBusiness(log, scope.businessId);
  };

  const scopedLogs = logs
    .filter(belongsToScope)
    .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));

  return humanizeActivityFeed(scopedLogs, {
    resolveCompany: (companyId) => names.get(companyId)
  }).slice(0, max);
}

// ── Inbox ───────────────────────────────────────────────────

/**
 * A conversation genuinely waiting on a person. Unsubscribed prospects are
 * never work for the user, whatever flags were set before they opted out.
 */
export function requiresHumanAttention(conversation: ConversationDoc): boolean {
  if (conversation.status === "suppressed") return false;
  return Boolean(
    conversation.unreadHumanAttention ||
      conversation.humanAttentionRequired ||
      conversation.status === "human_escalated"
  );
}

/** Plain-language explanation of why a conversation needs a human. */
export function attentionReason(conversation: ConversationDoc): string {
  // A DM reply cannot be sent from the app: say where the one action is.
  if (awaitsSessionSend(conversation)) {
    return `Open your ${networkLabel(channelOf(conversation))} session to check the reply and press Enter to send it`;
  }
  if (conversation.escalationReason) return conversation.escalationReason;
  if (conversation.status === "human_escalated") return "Your SDR was not confident enough to answer";
  if (conversation.latestObjection) return "They raised an objection";
  if (conversation.draftResponse) return "A reply is ready for your review";
  return "They are waiting for an answer";
}

export async function getAttentionRequired(scope: Scope): Promise<AttentionItem[]> {
  const [conversations, companies] = await Promise.all([
    fetchScoped<ConversationDoc>(collections.conversations, scope),
    fetchScoped<Company>(collections.companies, scope)
  ]);

  const names = new Map(companies.map((company) => [company.id, company.name]));

  return conversations
    .filter((conversation) => matchesBusiness(conversation, scope.businessId))
    .filter(requiresHumanAttention)
    .sort((a, b) => (toDate(b.lastMessageAt)?.getTime() ?? 0) - (toDate(a.lastMessageAt)?.getTime() ?? 0))
    .map((conversation) => ({
      conversation,
      companyName: names.get(conversation.companyId) ?? "A prospect",
      reason: attentionReason(conversation)
    }));
}

// ── Meetings ────────────────────────────────────────────────

export interface UpcomingMeeting {
  id: string;
  title: string;
  companyId?: string;
  companyName: string;
  startTime: Date | null;
  status: string;
  bookedBySdr: boolean;
  meetingUrl?: string;
}

export interface MeetingGroup {
  label: string;
  meetings: UpcomingMeeting[];
}

function dayLabel(date: Date, now: Date): string {
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays > 1 && diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export async function getUpcomingMeetings(scope: Scope, now = new Date()): Promise<UpcomingMeeting[]> {
  const all = await listScopedMeetings(scope);
  return all
    .filter((meeting) => meeting.startTime !== null && meeting.startTime.getTime() >= now.getTime())
    .sort((a, b) => (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0));
}

/**
 * Meetings that have already happened, newest first. The record of what the
 * SDR actually delivered must stay reachable, not only what is next.
 */
export async function getPastMeetings(scope: Scope, now = new Date()): Promise<UpcomingMeeting[]> {
  const all = await listScopedMeetings(scope);
  return all
    .filter((meeting) => meeting.startTime !== null && meeting.startTime.getTime() < now.getTime())
    .sort((a, b) => (b.startTime?.getTime() ?? 0) - (a.startTime?.getTime() ?? 0));
}

async function listScopedMeetings(scope: Scope): Promise<UpcomingMeeting[]> {
  const [meetings, companies] = await Promise.all([
    fetchScoped<{
      id: string;
      businessId?: string;
      companyId?: string;
      title?: string;
      startTime?: unknown;
      status?: string;
      bookingSource?: string;
      source?: string;
      meetingUrl?: string;
    }>("meetings", scope),
    fetchScoped<Company>(collections.companies, scope)
  ]);

  const names = new Map(companies.map((company) => [company.id, company.name]));

  return meetings
    .filter((meeting) => matchesBusiness(meeting, scope.businessId))
    .filter((meeting) => meeting.status !== "cancelled")
    .map((meeting) => ({
      id: meeting.id,
      title: meeting.title || "Meeting",
      companyId: meeting.companyId,
      companyName: (meeting.companyId && names.get(meeting.companyId)) || "A prospect",
      startTime: toDate(meeting.startTime),
      status: meeting.status ?? "scheduled",
      bookedBySdr: meeting.bookingSource === "conversational" || meeting.source === "sdr",
      meetingUrl: meeting.meetingUrl
    }));
}

/** Groups meetings into Today / Tomorrow / weekday / date buckets. */
export function groupMeetingsByDay(meetings: UpcomingMeeting[], now = new Date()): MeetingGroup[] {
  const groups: MeetingGroup[] = [];
  for (const meeting of meetings) {
    if (!meeting.startTime) continue;
    const label = dayLabel(meeting.startTime, now);
    const existing = groups.find((group) => group.label === label);
    if (existing) existing.meetings.push(meeting);
    else groups.push({ label, meetings: [meeting] });
  }
  return groups;
}
