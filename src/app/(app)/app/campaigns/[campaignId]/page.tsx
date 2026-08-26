import { CampaignOverview } from "@/features/campaigns/campaign-overview";

export default async function Page({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  return <CampaignOverview campaignId={campaignId} />;
}
