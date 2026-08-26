"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  HelpCircle,
  Loader2,
  Lock,
  MessageSquare,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
  UserX,
  XCircle
} from "lucide-react";
import type { ConversationDoc, MessageDoc, ReplyDraft } from "@/types/firestore";
import { listMessagesForConversation } from "@/lib/firebase/firestore";
import {
  callApproveAndSendReply,
  callEscalateConversation,
  callReleaseTakeover,
  callSendManualReply,
  callTakeOverConversation,
  callUpdateConversationStatus
} from "@/lib/firebase/functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ConversationThreadView({
  conversation,
  onRefresh,
  className
}: {
  conversation: ConversationDoc;
  onRefresh: () => Promise<void>;
  className?: string;
}) {
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [manualSubject, setManualSubject] = useState("Re: Proposition Devcomm");
  const [manualBody, setManualBody] = useState("");
  const [showManualComposer, setShowManualComposer] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        setLoading(true);
        const msgs = await listMessagesForConversation(conversation.id);
        if (isMounted) {
          setMessages(msgs);
          const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");
          if (lastInbound?.subject) {
            setManualSubject(lastInbound.subject.startsWith("Re:") ? lastInbound.subject : `Re: ${lastInbound.subject}`);
          }
        }
      } catch (err) {
        console.error("Failed to load messages", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    void load();
    return () => {
      isMounted = false;
    };
  }, [conversation.id]);

  async function handleTakeOver() {
    setActionBusy("takeover");
    setFeedbackMsg(null);
    try {
      if (conversation.manualTakeover) {
        await callReleaseTakeover({ conversationId: conversation.id });
        setFeedbackMsg({ type: "success", text: "Prise en main relâchée. Gestion automatique réactivée." });
      } else {
        await callTakeOverConversation({ conversationId: conversation.id });
        setFeedbackMsg({ type: "success", text: "Prise en main manuelle activée. Réponses automatiques en pause." });
      }
      await onRefresh();
    } catch (err) {
      setFeedbackMsg({ type: "error", text: err instanceof Error ? err.message : "Action de prise en main échouée." });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleSendManualReply() {
    if (!manualBody.trim()) {
      setFeedbackMsg({ type: "error", text: "Veuillez saisir le texte de votre réponse." });
      return;
    }
    setActionBusy("send_manual");
    setFeedbackMsg(null);
    try {
      await callSendManualReply({
        conversationId: conversation.id,
        subject: manualSubject,
        bodyText: manualBody
      });
      setManualBody("");
      setShowManualComposer(false);
      setFeedbackMsg({ type: "success", text: "Message envoyé avec succès au prospect !" });
      const msgs = await listMessagesForConversation(conversation.id);
      setMessages(msgs);
      await onRefresh();
    } catch (err) {
      setFeedbackMsg({ type: "error", text: err instanceof Error ? err.message : "Échec de l'envoi manuel." });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleSuppress() {
    if (typeof window !== "undefined" && !window.confirm("Voulez-vous supprimer / désinscrire ce prospect et suspendre toute séquence ?")) return;
    setActionBusy("suppress");
    try {
      await callUpdateConversationStatus({
        conversationId: conversation.id,
        status: "suppressed"
      });
      setFeedbackMsg({ type: "success", text: "Prospect désinscrit et marqué comme supprimé." });
      await onRefresh();
    } catch (err) {
      setFeedbackMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur suppression." });
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className={`flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden ${className || ""}`}>
      {/* ── 1. Thread Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 bg-slate-50/70">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <MessageSquare className="size-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">
              Discussion : <span className="font-semibold text-slate-700">{conversation.contactId}</span>
            </h2>
            <ConversationStatusBadge status={conversation.status} />
            {conversation.latestIntent && (
              <IntentPill intent={conversation.latestIntent} objection={conversation.latestObjection} />
            )}
            {conversation.manualTakeover && (
              <Badge className="bg-amber-500 text-white text-[10px] flex items-center gap-1">
                <Lock className="size-3" />
                Prise en main SDR
              </Badge>
            )}
            {conversation.unreadHumanAttention && (
              <Badge variant="destructive" className="animate-pulse text-[10px]">
                Action Requise
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            Entreprise : <span className="font-medium text-slate-600">{conversation.companyId}</span>
            {conversation.assignedRepUserId ? ` • Rep: ${conversation.assignedRepUserId}` : ""}
            {` • ${messages.length} message${messages.length !== 1 ? "s" : ""}`}
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant={conversation.manualTakeover ? "outline" : "default"}
            disabled={actionBusy === "takeover"}
            onClick={handleTakeOver}
            className={`text-xs h-7.5 px-3 gap-1.5 ${
              conversation.manualTakeover
                ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {actionBusy === "takeover" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : conversation.manualTakeover ? (
              <Unlock className="size-3.5 text-amber-700" />
            ) : (
              <Lock className="size-3.5" />
            )}
            {conversation.manualTakeover ? "Relâcher le contrôle" : "Prendre la main"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowManualComposer(!showManualComposer)}
            className="text-xs h-7.5 px-3 gap-1.5 border-slate-300"
          >
            <Edit3 className="size-3.5 text-slate-600" />
            {showManualComposer ? "Masquer le rédacteur" : "Répondre manuellement"}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={actionBusy === "suppress"}
            onClick={handleSuppress}
            className="text-xs h-7.5 px-2.5 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
            title="Désinscrire le contact"
          >
            <UserX className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Feedback banner */}
      {feedbackMsg && (
        <div
          className={`px-4 py-2 text-xs font-medium border-b flex items-center justify-between ${
            feedbackMsg.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          <span>{feedbackMsg.text}</span>
          <button onClick={() => setFeedbackMsg(null)} className="text-[11px] hover:underline">
            ✕
          </button>
        </div>
      )}

      {/* ── 2. Message Timeline Body ── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            <Loader2 className="size-5 animate-spin mx-auto mb-2 text-blue-600" />
            Chargement de la conversation...
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">
            Aucun message enregistré dans ce fil.
          </div>
        ) : (
          messages.map((msg, index) => {
            const isInbound = msg.direction === "inbound";
            const classification = msg.replyClassification;

            return (
              <div
                key={msg.id || index}
                className={`relative rounded-xl border p-4 transition-all ${
                  isInbound
                    ? "border-emerald-200 bg-emerald-50/40 text-slate-900 shadow-2xs mr-8"
                    : "border-slate-200 bg-slate-50/60 text-slate-900 ml-8"
                }`}
              >
                {/* Header info */}
                <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 pb-2 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isInbound ? (
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                        <ArrowDownLeft className="size-3.5" />
                        Réponse Prospect
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-bold text-indigo-700">
                        <ArrowUpRight className="size-3.5" />
                        Message Sortant Devcomm
                      </span>
                    )}
                    <span className="text-slate-500">
                      De : <span className="font-mono text-slate-800 text-[11px]">{msg.senderEmail}</span>
                    </span>
                  </div>
                  {msg.sentAt && (
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock className="size-3" />
                      {formatDate(msg.sentAt)}
                    </span>
                  )}
                </div>

                {/* AI Reply Classification Box for Inbound */}
                {isInbound && classification && (
                  <div className="mt-2.5 mb-2 rounded-lg border border-emerald-200/80 bg-white/95 p-3 text-xs shadow-2xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                          <Sparkles className="size-3 text-emerald-600" />
                          Diagnostic IA :
                        </span>
                        <IntentPill intent={classification.intent} objection={classification.objectionType} />
                        {typeof classification.confidence === "number" && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                            Confiance {Math.round(classification.confidence * 100)}%
                          </span>
                        )}
                      </div>
                      {classification.requiresHumanAttention && (
                        <Badge variant="destructive" className="text-[10px]">
                          Alerte SDR
                        </Badge>
                      )}
                    </div>

                    {classification.detectedQuestions && classification.detectedQuestions.length > 0 && (
                      <div className="mt-2 text-[11px] text-slate-700 border-t border-slate-100 pt-1.5">
                        <span className="font-semibold text-slate-800">Questions détectées :</span>
                        <ul className="list-disc list-inside mt-0.5 space-y-0.5 text-slate-600">
                          {classification.detectedQuestions.map((q, qIdx) => (
                            <li key={qIdx}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {classification.reasoning && (
                      <div className="mt-1 text-[10px] text-slate-500 italic">
                        {classification.reasoning}
                      </div>
                    )}
                  </div>
                )}

                {/* Email Subject & Body */}
                <div className="pt-2">
                  {msg.subject && (
                    <div className="font-semibold text-xs text-slate-800 mb-1">
                      Objet : {msg.subject}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap text-xs text-slate-700 leading-relaxed font-sans">
                    {msg.bodyText}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* ── 3. AI Reply Draft Card (REQ-068) ── */}
        {conversation.draftResponse && (
          <ReplyDraftCard
            conversation={conversation}
            draft={conversation.draftResponse}
            onApprove={async (customSubject, customBody) => {
              await callApproveAndSendReply({
                conversationId: conversation.id,
                customSubject,
                customBodyText: customBody
              });
              setFeedbackMsg({ type: "success", text: "Réponse IA validée et envoyée avec succès !" });
              await onRefresh();
            }}
            onEscalate={async (reason) => {
              await callEscalateConversation({
                conversationId: conversation.id,
                reason
              });
              setFeedbackMsg({ type: "success", text: "Conversation escaladée à un représentant humain." });
              await onRefresh();
            }}
          />
        )}

        {/* ── 4. Manual Rep Reply Composer ── */}
        {showManualComposer && (
          <Card className="border-2 border-blue-200 bg-blue-50/30 shadow-xs">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs font-bold text-blue-950 flex items-center gap-1.5">
                <Edit3 className="size-4 text-blue-600" />
                Rédiger une Réponse Manuelle Directe
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-slate-700">Objet du message :</label>
                <Input
                  value={manualSubject}
                  onChange={(e) => setManualSubject(e.target.value)}
                  className="mt-0.5 text-xs bg-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-700">Corps du message :</label>
                <Textarea
                  rows={5}
                  value={manualBody}
                  onChange={(e) => setManualBody(e.target.value)}
                  placeholder="Bonjour Thomas, merci pour votre retour..."
                  className="mt-0.5 text-xs bg-white font-sans leading-relaxed"
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowManualComposer(false)}
                  className="text-xs text-slate-500"
                >
                  Annuler
                </Button>
                <Button
                  size="sm"
                  disabled={actionBusy === "send_manual"}
                  onClick={handleSendManualReply}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-4 gap-1.5"
                >
                  {actionBusy === "send_manual" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  Envoyer la réponse
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export function IntentPill({ intent, objection }: { intent?: string; objection?: string }) {
  if (!intent) return null;

  switch (intent) {
    case "BOOKING_REQUEST":
      return (
        <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 text-[10px] flex items-center gap-1">
          <CalendarCheck className="size-3" />
          Rendez-vous Demandé
        </Badge>
      );
    case "POSITIVE":
      return (
        <Badge className="border-teal-300 bg-teal-100 text-teal-800 text-[10px] flex items-center gap-1">
          <CheckCircle2 className="size-3" />
          Intérêt Positif
        </Badge>
      );
    case "QUESTION":
      return (
        <Badge className="border-blue-300 bg-blue-100 text-blue-800 text-[10px] flex items-center gap-1">
          <HelpCircle className="size-3" />
          Question {objection === "PRICE" ? "Tarif" : ""}
        </Badge>
      );
    case "OBJECTION":
      return (
        <Badge className="border-amber-300 bg-amber-100 text-amber-800 text-[10px] flex items-center gap-1">
          <AlertCircle className="size-3" />
          Objection : {formatObjectionLabel(objection)}
        </Badge>
      );
    case "UNSUBSCRIBE":
      return (
        <Badge className="border-rose-300 bg-rose-100 text-rose-800 text-[10px] flex items-center gap-1">
          <XCircle className="size-3" />
          Désinscription
        </Badge>
      );
    case "OUT_OF_OFFICE":
      return (
        <Badge className="border-slate-300 bg-slate-100 text-slate-700 text-[10px] flex items-center gap-1">
          <Clock className="size-3" />
          Absence / OOO
        </Badge>
      );
    case "WRONG_PERSON":
      return (
        <Badge className="border-purple-300 bg-purple-100 text-purple-800 text-[10px] flex items-center gap-1">
          <UserX className="size-3" />
          Mauvais Contact
        </Badge>
      );
    case "ANGRY":
      return (
        <Badge variant="destructive" className="text-[10px] flex items-center gap-1">
          <ShieldAlert className="size-3" />
          Hostile / Risque
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px]">
          {intent}
        </Badge>
      );
  }
}

function formatObjectionLabel(objection?: string): string {
  switch (objection) {
    case "PRICE":
      return "Prix / Devis";
    case "EXISTING_PROVIDER":
      return "Prestataire en place";
    case "NO_BUDGET":
      return "Pas de budget";
    case "NOT_PRIORITY":
      return "Pas prioritaire";
    case "BAD_TIMING":
      return "Mauvais timing";
    case "NO_TIME":
      return "Pas le temps";
    default:
      return objection || "Générale";
  }
}

export function ConversationStatusBadge({ status }: { status?: string }) {
  switch (status) {
    case "sequence_active":
      return <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-[10px]">Séquence Active</Badge>;
    case "in_dialogue":
      return <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px]">En Dialogue</Badge>;
    case "meeting_booked":
      return <Badge variant="outline" className="border-purple-300 bg-purple-50 text-purple-700 text-[10px]">Rendez-vous Fixé</Badge>;
    case "human_escalated":
      return <Badge variant="destructive" className="text-[10px]">Escalade Humaine</Badge>;
    case "suppressed":
      return <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-600 text-[10px]">Désinscrit</Badge>;
    case "lost":
      return <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 text-[10px]">Perdu / Bounced</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status || "Brouillon"}</Badge>;
  }
}

function formatDate(dateVal: unknown): string {
  if (!dateVal) return "";
  let d: Date;
  if (typeof (dateVal as { toDate?: () => Date }).toDate === "function") {
    d = (dateVal as { toDate: () => Date }).toDate();
  } else if (dateVal instanceof Date) {
    d = dateVal;
  } else {
    d = new Date(String(dateVal));
  }
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function ReplyDraftCard({
  conversation: _conversation,
  draft,
  onApprove,
  onEscalate
}: {
  conversation: ConversationDoc;
  draft: ReplyDraft;
  onApprove?: (customSubject: string, customBody: string) => Promise<void>;
  onEscalate?: (reason: string) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [bodyText, setBodyText] = useState(draft.bodyText);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isAutoDispatched = draft.status === "auto_dispatched";
  const isApproved = draft.status === "approved_and_sent" || draft.status === "manual_override_sent";

  const handleApproveAndSend = async () => {
    setActionLoading(true);
    setStatusMessage(null);
    try {
      if (onApprove) {
        await onApprove(subject, bodyText);
      }
      setStatusMessage("Réponse validée et envoyée avec succès !");
      setIsEditing(false);
    } catch (err) {
      console.error(err);
      setStatusMessage("Erreur lors de l'envoi de la réponse.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleEscalate = async () => {
    setActionLoading(true);
    setStatusMessage(null);
    try {
      if (onEscalate) {
        await onEscalate("Escalade manuelle par l'opérateur SDR");
      }
      setStatusMessage("Conversation escaladée à un représentant humain.");
    } catch (err) {
      console.error(err);
      setStatusMessage("Erreur lors de l'escalade.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="relative rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-purple-50/50 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-indigo-100 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 font-bold text-xs text-indigo-950">
            <Sparkles className="size-4 text-indigo-600 animate-pulse" />
            Proposition de Réponse IA (Grounded & Sécurisée)
          </div>
          {typeof draft.confidence === "number" && (
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 font-mono text-[10px] text-indigo-700">
              Confiance: {Math.round(draft.confidence * 100)}%
            </Badge>
          )}
          {draft.pricingGuardrailPassed ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 flex items-center gap-1">
              <ShieldCheck className="size-3 text-emerald-600" />
              Tarification Conforme
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700 flex items-center gap-1">
              <AlertTriangle className="size-3 text-amber-600" />
              Devis Sur Mesure Requis
            </Badge>
          )}
          {isAutoDispatched ? (
            <Badge className="border-teal-300 bg-teal-100 text-teal-800 text-[10px]">
              Auto-envoi Programmé
            </Badge>
          ) : isApproved ? (
            <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 text-[10px]">
              Envoyé par l'opérateur
            </Badge>
          ) : (
            <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700 text-[10px]">
              En attente d'approbation
            </Badge>
          )}
        </div>
        {draft.draftedAt && (
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock className="size-3" />
            {formatDate(draft.draftedAt)}
          </span>
        )}
      </div>

      {/* Cited Knowledge Base Proof Points */}
      {draft.citedKnowledgePoints && draft.citedKnowledgePoints.length > 0 && (
        <div className="mt-2.5 rounded-md border border-indigo-100/80 bg-white/80 p-2 text-xs">
          <span className="font-medium text-[11px] text-indigo-900 flex items-center gap-1">
            <FileText className="size-3 text-indigo-600" />
            Points d'appui KnowledgeBase cités :
          </span>
          <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px] text-slate-700">
            {draft.citedKnowledgePoints.map((pt, pIdx) => (
              <li key={pIdx}>{pt}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Draft Content & Editor */}
      <div className="mt-3 space-y-2">
        {isEditing ? (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] font-medium text-slate-700">Sujet :</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-0.5 text-xs bg-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-700">Corps du message :</label>
              <Textarea
                rows={5}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                className="mt-0.5 text-xs bg-white font-sans leading-relaxed"
              />
            </div>
          </div>
        ) : (
          <div>
            <div className="text-xs font-semibold text-slate-800 mb-1">
              Sujet : <span className="font-normal">{subject}</span>
            </div>
            <div className="whitespace-pre-wrap text-xs text-slate-800 leading-relaxed rounded-lg border border-slate-200 bg-white/95 p-3 font-sans shadow-2xs">
              {bodyText}
            </div>
          </div>
        )}
      </div>

      {statusMessage && (
        <div className="mt-2 text-xs text-emerald-700 font-medium bg-emerald-50 p-2 rounded border border-emerald-200">
          {statusMessage}
        </div>
      )}

      {/* Interactive Action Toolbar */}
      {!isAutoDispatched && !isApproved && (
        <div className="mt-3.5 flex items-center justify-between gap-2 flex-wrap border-t border-indigo-100 pt-3">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={actionLoading}
              onClick={handleApproveAndSend}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 px-3.5 gap-1.5 shadow-xs"
            >
              <Send className="size-3.5" />
              Approuver et Envoyer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={actionLoading}
              onClick={() => setIsEditing(!isEditing)}
              className="text-xs h-8 px-3 gap-1.5 bg-white border-slate-300 hover:bg-slate-50"
            >
              <Edit3 className="size-3.5 text-slate-600" />
              {isEditing ? "Aperçu" : "Modifier"}
            </Button>
          </div>

          <Button
            size="sm"
            variant="ghost"
            disabled={actionLoading}
            onClick={handleEscalate}
            className="text-xs h-8 text-rose-700 hover:bg-rose-50 hover:text-rose-800 gap-1.5"
          >
            <ShieldAlert className="size-3.5 text-rose-600" />
            Escalader à un humain
          </Button>
        </div>
      )}
    </div>
  );
}
