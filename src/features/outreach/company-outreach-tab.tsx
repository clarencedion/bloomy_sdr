import { useCallback, useEffect, useMemo, useState } from "react";
import type { Company, Contact, ConversationDoc, LeadResearch, Outreach } from "@/types/firestore";
import { getConversationForCompany, listOutreachForCompany, listResearchForCompany } from "@/lib/firebase/firestore";
import { EmptyState } from "@/components/common/empty-state";
import { Mail } from "lucide-react";
import { OutreachEditor } from "@/features/outreach/outreach-editor";
import { ConversationTimeline } from "@/features/conversations/conversation-timeline";

export function CompanyOutreachTab({ company, contacts }: { company: Company; contacts: Contact[] }) {
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [research, setResearch] = useState<LeadResearch[]>([]);
  const [conversation, setConversation] = useState<ConversationDoc | null>(null);

  const refresh = useCallback(async () => {
    const [outreachResults, researchResults, convResult] = await Promise.all([
      listOutreachForCompany(company.id),
      listResearchForCompany(company.id),
      getConversationForCompany(company.id)
    ]);
    setOutreach(outreachResults);
    setResearch(researchResults);
    setConversation(convResult);
  }, [company.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const latestResearch = useMemo(() => research.find((item) => item.status === "completed"), [research]);
  const latestOutreach = outreach[0];

  return (
    <div className="space-y-6">
      {!latestResearch ? (
        <EmptyState icon={Mail} title="Research required first" description="Run AI Research before generating outreach. This keeps drafts grounded in validated research." />
      ) : null}

      {conversation && (
        <ConversationTimeline conversation={conversation} />
      )}

      <OutreachEditor company={company} contacts={contacts} research={latestResearch} outreach={latestOutreach} onRefresh={refresh} />
    </div>
  );
}

