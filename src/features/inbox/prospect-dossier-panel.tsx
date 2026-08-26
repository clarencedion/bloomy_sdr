"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Calendar,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  TrendingUp,
  User,
  Users
} from "lucide-react";
import type { Company, Contact, ConversationDoc, EvidenceItem } from "@/types/firestore";
import { getCompany, getContact, listCompanyEvidence } from "@/lib/firebase/firestore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ProspectDossierPanel({
  conversation,
  className
}: {
  conversation: ConversationDoc;
  className?: string;
}) {
  const [company, setCompany] = useState<Company | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);
        const [compData, contactData] = await Promise.all([
          conversation.companyId ? getCompany(conversation.companyId) : Promise.resolve(null),
          conversation.contactId ? getContact(conversation.contactId) : Promise.resolve(null)
        ]);

        let evidenceData: EvidenceItem[] = [];
        if (conversation.companyId) {
          evidenceData = await listCompanyEvidence(conversation.companyId);
        }

        if (isMounted) {
          setCompany(compData);
          setContact(contactData);
          setEvidence(evidenceData);
        }
      } catch (err) {
        console.error("Failed to load prospect dossier for conversation", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void loadData();
    return () => {
      isMounted = false;
    };
  }, [conversation.companyId, conversation.contactId]);

  if (loading) {
    return (
      <div className={`p-4 text-center text-xs text-muted-foreground ${className || ""}`}>
        Chargement du dossier prospect...
      </div>
    );
  }

  const oppScore = company?.opportunityScore;

  return (
    <div className={`space-y-4 overflow-y-auto ${className || ""}`}>
      {/* ── 1. Company Profile Card ── */}
      <Card className="shadow-xs border-slate-200">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Entreprise</div>
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-1.5 mt-0.5">
                <Building2 className="size-4 text-blue-600 shrink-0" />
                <span className="truncate">{company?.name || conversation.companyId}</span>
              </CardTitle>
            </div>
            {company && (
              <Link
                href={`/app/companies/${company.id}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline"
              >
                Fiche <ExternalLink className="size-3" />
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-2 text-xs text-slate-600">
          {company?.domain && (
            <div className="flex items-center gap-2">
              <Globe className="size-3.5 text-slate-400 shrink-0" />
              <a
                href={company.website || `https://${company.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-blue-600 hover:underline font-mono text-[11px]"
              >
                {company.domain}
              </a>
            </div>
          )}
          {company?.city && (
            <div className="flex items-center gap-2">
              <MapPin className="size-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{company.city} {company.postalCode ? `(${company.postalCode})` : ""}</span>
            </div>
          )}
          {company?.industry && (
            <div className="flex items-center gap-2">
              <Users className="size-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{company.industry}</span>
            </div>
          )}
          {company?.employeeCount !== undefined && (
            <div className="text-[11px] text-slate-500">
              Effectif estimé : <span className="font-semibold text-slate-700">{company.employeeCount} salariés</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 2. Decision Maker Contact Card ── */}
      <Card className="shadow-xs border-slate-200">
        <CardHeader className="p-4 pb-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Interlocuteur</div>
          <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-1.5 mt-0.5">
            <User className="size-4 text-indigo-600 shrink-0" />
            <span className="truncate">{contact?.fullName || contact?.email || conversation.contactId}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-2 text-xs text-slate-600">
          {contact?.role && (
            <div className="font-medium text-slate-800 text-[12px]">
              {contact.role}
              {contact.seniority ? ` (${contact.seniority})` : ""}
            </div>
          )}
          {contact?.email && (
            <div className="flex items-center gap-2">
              <Mail className="size-3.5 text-slate-400 shrink-0" />
              <a href={`mailto:${contact.email}`} className="truncate text-blue-600 hover:underline font-mono text-[11px]">
                {contact.email}
              </a>
            </div>
          )}
          {contact?.phone && (
            <div className="flex items-center gap-2">
              <Phone className="size-3.5 text-slate-400 shrink-0" />
              <span className="font-mono text-[11px]">{contact.phone}</span>
            </div>
          )}
          {contact?.personaMatched && (
            <div className="pt-1">
              <Badge variant="outline" className="text-[10px] border-indigo-200 bg-indigo-50 text-indigo-700">
                Persona : {contact.personaMatched}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 3. Opportunity Score & Qualification ── */}
      {oppScore && (
        <Card className="shadow-xs border-slate-200 bg-gradient-to-br from-slate-50/80 to-white">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Opportunité IA</div>
              <Badge className="bg-blue-600 text-white font-bold text-[11px]">
                {oppScore.overallScore}/100
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-2 space-y-2 text-xs">
            <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
              <div className="rounded border bg-white p-1.5">
                <div className="text-slate-400">Fit</div>
                <div className="font-bold text-slate-800 mt-0.5">{oppScore.companyFitScore ?? "—"}</div>
              </div>
              <div className="rounded border bg-white p-1.5">
                <div className="text-slate-400">Besoin</div>
                <div className="font-bold text-slate-800 mt-0.5">{oppScore.needStrengthScore ?? "—"}</div>
              </div>
              <div className="rounded border bg-white p-1.5">
                <div className="text-slate-400">Valeur</div>
                <div className="font-bold text-slate-800 mt-0.5">{oppScore.commercialValueScore ?? "—"}</div>
              </div>
            </div>
            {oppScore.detectedNeeds && oppScore.detectedNeeds.length > 0 && (
              <div className="pt-1 text-[11px] text-slate-600">
                <div className="font-medium text-slate-700 mb-1 flex items-center gap-1">
                  <TrendingUp className="size-3 text-blue-600" />
                  Besoins détectés :
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-slate-600 text-[10px]">
                  {oppScore.detectedNeeds.slice(0, 3).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 4. Verified Evidence Items ── */}
      {evidence.length > 0 && (
        <Card className="shadow-xs border-slate-200">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Preuves Vérifiées ({evidence.length})
              </div>
              <ShieldCheck className="size-4 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-2 space-y-2 text-xs">
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {evidence.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-slate-100 bg-slate-50/70 p-2 text-[11px] space-y-0.5"
                >
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span className="truncate">{item.key.replace(/_/g, " ")}</span>
                    <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
                      {item.confidence}%
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    Provider : {item.signalProvider} {item.sourceUrl ? `• ${item.sourceUrl}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 5. Quick Actions ── */}
      <div className="space-y-2 pt-2">
        <Link href="/app/meetings" className="w-full block">
          <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 justify-center border-slate-300">
            <Calendar className="size-3.5 text-indigo-600" />
            Planifier un Rendez-vous
          </Button>
        </Link>
      </div>
    </div>
  );
}
