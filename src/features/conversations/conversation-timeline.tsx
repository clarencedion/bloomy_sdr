"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  HelpCircle,
  MessageSquare,
  ShieldAlert,
  Sparkles,
  UserX,
  XCircle,
  CalendarCheck,
  CheckCircle2,
  AlertCircle,
  Send,
  Edit3,
  ShieldCheck,
  AlertTriangle,
  FileText
} from "lucide-react";
import type { ConversationDoc, MessageDoc, ReplyDraft } from "@/types/firestore";
import { listMessagesForConversation } from "@/lib/firebase/firestore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ConversationTimeline({
  conversation,
  className
}: {
  conversation: ConversationDoc;
  className?: string;
}) {
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        setLoading(true);
        const msgs = await listMessagesForConversation(conversation.id);
        if (isMounted) setMessages(msgs);
      } catch (err) {
        console.error("Failed to load messages for conversation", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    void load();
    return () => {
      isMounted = false;
    };
  }, [conversation.id]);

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-4 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <MessageSquare className="size-5 text-indigo-600" />
            <CardTitle className="text-base font-semibold">Fil de Conversation</CardTitle>
            <ConversationStatusBadge status={conversation.status} />
            {conversation.latestIntent && (
              <IntentPill intent={conversation.latestIntent} objection={conversation.latestObjection} />
            )}
            {conversation.unreadHumanAttention && (
              <Badge variant="destructive" className="animate-pulse text-[10px]">
                Attention SDR Requise
              </Badge>
            )}
          </div>
          <CardDescription className="mt-1 text-xs text-muted-foreground">
            {messages.length} message{messages.length !== 1 ? "s" : ""} échangé{messages.length !== 1 ? "s" : ""}
            {conversation.instantlyLeadId ? ` • Lead Instantly ID: ${conversation.instantlyLeadId}` : ""}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Chargement des messages...</div>
        ) : messages.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            Aucun message enregistré dans cette conversation.
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, index) => {
              const isInbound = msg.direction === "inbound";
              const classification = msg.replyClassification;
              return (
                <div
                  key={msg.id || index}
                  className={`relative rounded-lg border p-4 transition-all ${
                    isInbound
                      ? "border-emerald-200 bg-emerald-50/50 text-emerald-950 shadow-sm"
                      : "border-slate-200 bg-slate-50/60 text-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 border-b pb-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isInbound ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                          <ArrowDownLeft className="size-3.5" />
                          Réponse Inbound (Prospect)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-indigo-700">
                          <ArrowUpRight className="size-3.5" />
                          Outbound Séquence (Devcomm)
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        De: <span className="font-mono text-slate-700">{msg.senderEmail}</span>
                      </span>
                    </div>
                    {msg.sentAt && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="size-3" />
                        {formatDate(msg.sentAt)}
                      </span>
                    )}
                  </div>

                  {/* Reply Intelligence Header for Inbound Messages */}
                  {isInbound && classification && (
                    <div className="mt-2.5 mb-2 rounded-md border border-emerald-100 bg-white/90 p-2.5 text-xs shadow-xs">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                            <Sparkles className="size-3 text-emerald-600" />
                            Analyse IA :
                          </span>
                          <IntentPill intent={classification.intent} objection={classification.objectionType} />
                          {typeof classification.confidence === "number" && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                              Confiance: {Math.round(classification.confidence * 100)}%
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
                        <div className="mt-2 text-[11px] text-slate-600 border-t pt-1.5">
                          <span className="font-medium text-slate-700">Questions détectées :</span>
                          <ul className="list-disc list-inside mt-0.5 space-y-0.5 text-slate-600">
                            {classification.detectedQuestions.map((q, qIdx) => (
                              <li key={qIdx}>{q}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {classification.reasoning && (
                        <div className="mt-1 text-[10px] text-muted-foreground italic">
                          {classification.reasoning}
                        </div>
                      )}
                    </div>
                  )}

                    <div className="pt-2">
                    {msg.subject && (
                      <div className="font-medium text-xs text-slate-800 mb-1">
                        Sujet: {msg.subject}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap text-xs text-slate-700 leading-relaxed font-sans">
                      {msg.bodyText}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* AI Reply Draft Panel (REQ-066, REQ-067, REQ-068, REQ-069) */}
            {conversation.draftResponse && (
              <ReplyDraftCard
                conversation={conversation}
                draft={conversation.draftResponse}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IntentPill({
  intent,
  objection
}: {
  intent?: string;
  objection?: string;
}) {
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
      return "Prix / Tarif";
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
      return <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-600 text-[10px]">Supprimé / Désinscrit</Badge>;
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
  const isApproved = draft.status === "approved_and_sent";

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
    <div className="relative rounded-lg border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-purple-50/50 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-indigo-100 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 font-semibold text-xs text-indigo-950">
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
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
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
            <div className="whitespace-pre-wrap text-xs text-slate-800 leading-relaxed rounded-md border border-slate-200 bg-white/95 p-3 font-sans shadow-2xs">
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
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 px-3 gap-1.5 shadow-xs"
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

