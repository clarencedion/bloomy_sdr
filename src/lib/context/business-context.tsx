"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { BusinessDoc, OfferDoc, KnowledgeBaseDoc } from "@/types/firestore";
import {
  listBusinessesClient,
  saveBusinessClient,
  listOffersClient,
  getKnowledgeBaseClient,
  saveKnowledgeBaseClient,
  saveOfferClient,
  deleteBusinessClient,
} from "@/lib/firebase/firestore";

interface BusinessContextType {
  workspaceId: string;
  businesses: BusinessDoc[];
  currentBusiness: BusinessDoc | null;
  currentBusinessId: string;
  offers: OfferDoc[];
  knowledgeBase: KnowledgeBaseDoc | null;
  loading: boolean;
  switchBusiness: (businessId: string) => void;
  createBusiness: (input: {
    name: string;
    legalName?: string;
    website?: string;
    primaryColor?: string;
    tagline?: string;
    automationPolicy?: Partial<BusinessDoc["automationPolicy"]>;
    calendarConfig?: Partial<BusinessDoc["calendarConfig"]>;
    senderConfig?: BusinessDoc["senderConfig"];
  }) => Promise<BusinessDoc>;
  deleteBusiness: (businessId: string) => Promise<void>;
  updateCurrentBusiness: (patch: Partial<BusinessDoc>) => Promise<BusinessDoc | null>;
  reloadBusinesses: () => Promise<void>;
  reloadOffers: () => Promise<void>;
  reloadKnowledgeBase: () => Promise<void>;
}

const BusinessContext = createContext<BusinessContextType | undefined>(undefined);

const STORAGE_KEY = "devcomm_active_business_id";

const DEFAULT_DEVCOMM: Omit<BusinessDoc, "createdAt" | "updatedAt"> = {
  id: "biz_devcomm",
  workspaceId: "ws_default",
  name: "Devcomm Consulting",
  legalName: "Devcomm SAS",
  website: "https://devcomm.fr",
  defaultLanguage: "fr",
  branding: {
    primaryColor: "#2563eb",
    tagline: "Commercial Performance & B2B Consulting",
  },
  automationPolicy: {
    mode: "assisted",
    dailyOutreachLimit: 50,
    dailyDiscoveryLimit: 100,
    requireApprovalBeforeSend: true,
    autoReplySafeThreshold: 0.85,
  },
  calendarConfig: {
    provider: "microsoft_graph",
    workingDays: [1, 2, 3, 4, 5],
    workingHours: { start: "09:00", end: "18:00" },
    timezone: "Europe/Paris",
  },
};

const DEFAULT_BLOOMY: Omit<BusinessDoc, "createdAt" | "updatedAt"> = {
  id: "biz_bloomy",
  workspaceId: "ws_default",
  name: "Bloomy Digital Studio",
  legalName: "Bloomy Digital Studio",
  website: "https://bloomydigital.com",
  defaultLanguage: "fr",
  branding: {
    primaryColor: "#059669",
    tagline: "High-Performance Websites & Digital Modernization",
  },
  automationPolicy: {
    mode: "assisted",
    dailyOutreachLimit: 40,
    dailyDiscoveryLimit: 80,
    requireApprovalBeforeSend: true,
    autoReplySafeThreshold: 0.85,
  },
  calendarConfig: {
    provider: "google_calendar",
    workingDays: [1, 2, 3, 4, 5],
    workingHours: { start: "09:00", end: "18:00" },
    timezone: "Europe/Paris",
  },
};

export function BusinessProvider({
  children,
  workspaceId = "ws_default",
}: {
  children: React.ReactNode;
  workspaceId?: string;
}) {
  const [businesses, setBusinesses] = useState<BusinessDoc[]>([]);
  const [currentBusinessId, setCurrentBusinessId] = useState<string>("");
  const [offers, setOffers] = useState<OfferDoc[]>([]);
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBaseDoc | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOffers = useCallback(async (bId: string) => {
    if (!bId) {
      setOffers([]);
      return;
    }
    try {
      const items = await listOffersClient(workspaceId, bId);
      setOffers(items);
    } catch (err) {
      console.error("Failed to load offers", err);
    }
  }, [workspaceId]);

  const loadKb = useCallback(async (bId: string) => {
    if (!bId) {
      setKnowledgeBase(null);
      return;
    }
    try {
      const kb = await getKnowledgeBaseClient(workspaceId, bId);
      setKnowledgeBase(kb);
    } catch (err) {
      console.error("Failed to load knowledge base", err);
    }
  }, [workspaceId]);

  const reloadBusinesses = useCallback(async () => {
    setLoading(true);
    try {
      let list = await listBusinessesClient(workspaceId);
      if (list.length === 0) {
        // Seed default businesses client-side if Firestore is empty
        const devcomm = await saveBusinessClient(workspaceId, DEFAULT_DEVCOMM);
        const bloomy = await saveBusinessClient(workspaceId, DEFAULT_BLOOMY);
        
        // Seed initial offers
        await saveOfferClient(workspaceId, devcomm.id, {
          id: "off_devcomm_commercial",
          name: "Commercial Performance & B2B Sales Coaching",
          description: "Sales training, outbound restructuring, and commercial coaching.",
          targetPersonas: [{ title: "Dirigeant", priority: 1, keywords: ["gérant", "directeur général"] }],
          valuePropositions: ["Accelerate B2B sales cycle by 35%"],
          proofPoints: ["+40% pipeline velocity"],
          prohibitedPromises: ["guaranteed revenue doubling in 30 days"],
        });

        await saveOfferClient(workspaceId, bloomy.id, {
          id: "off_bloomy_website_redesign",
          name: "Website Modernization & Mobile Optimization",
          description: "Ultra-fast, mobile-optimized showcase and e-commerce websites.",
          targetPersonas: [{ title: "Gérant / Artisan", priority: 1, keywords: ["artisan", "gérant", "patron"] }],
          valuePropositions: ["Instant mobile loading (<1.5s PageSpeed)"],
          proofPoints: ["95+ mobile PageSpeed scores"],
          prohibitedPromises: ["guaranteed #1 Google ranking in 48 hours"],
        });

        // Seed initial KBs
        await saveKnowledgeBaseClient(workspaceId, bloomy.id, {
          services: [{ name: "Showcase Website", description: "Modern responsive website.", idealFor: "Artisans" }],
          caseStudies: [{ title: "Atelier Floral", clientIndustry: "Florist", metric: "PageSpeed 24->98", description: "Modern redesign" }],
          pricingRules: ["Websites start at €1,490 HT."],
          faqs: [{ question: "Delivery time?", answer: "2-3 weeks." }],
          prohibitedPromises: ["No guaranteed rank #1."],
        });

        list = [bloomy, devcomm];
      }

      setBusinesses(list);

      // Determine active business ID
      const savedId = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      const matched = list.find((b) => b.id === savedId) || list[0];
      const activeId = matched ? matched.id : "";
      
      setCurrentBusinessId(activeId);
      if (activeId) {
        await Promise.all([loadOffers(activeId), loadKb(activeId)]);
      }
    } catch (err) {
      console.warn("Failed to list businesses, falling back to in-memory business profiles:", err);
      const fallbackList = [DEFAULT_DEVCOMM as unknown as BusinessDoc, DEFAULT_BLOOMY as unknown as BusinessDoc];
      setBusinesses(fallbackList);
      setCurrentBusinessId(fallbackList[0].id);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, loadOffers, loadKb]);

  useEffect(() => {
    void reloadBusinesses();
  }, [reloadBusinesses]);

  const switchBusiness = useCallback((bId: string) => {
    setCurrentBusinessId(bId);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, bId);
    }
    void loadOffers(bId);
    void loadKb(bId);
  }, [loadOffers, loadKb]);

  const createBusiness = useCallback(async (input: {
    name: string;
    legalName?: string;
    website?: string;
    primaryColor?: string;
    tagline?: string;
    automationPolicy?: Partial<BusinessDoc["automationPolicy"]>;
    calendarConfig?: Partial<BusinessDoc["calendarConfig"]>;
    senderConfig?: BusinessDoc["senderConfig"];
  }) => {
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 20);
    const newId = `biz_${slug}_${Date.now().toString(36)}`;
    const created = await saveBusinessClient(workspaceId, {
      id: newId,
      name: input.name,
      legalName: input.legalName,
      website: input.website,
      defaultLanguage: "fr",
      branding: {
        primaryColor: input.primaryColor || "#3b82f6",
        tagline: input.tagline || "",
      },
      automationPolicy: {
        mode: "assisted",
        dailyOutreachLimit: 40,
        dailyDiscoveryLimit: 80,
        requireApprovalBeforeSend: true,
        autoReplySafeThreshold: 0.85,
        ...input.automationPolicy,
      },
      calendarConfig: {
        provider: "google_calendar",
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: "09:00", end: "18:00" },
        timezone: "Europe/Paris",
        ...input.calendarConfig,
      },
      ...(input.senderConfig ? { senderConfig: input.senderConfig } : {}),
    });

    setBusinesses((prev) => [...prev, created]);
    switchBusiness(created.id);
    return created;
  }, [workspaceId, switchBusiness]);

  const deleteBusiness = useCallback(async (businessId: string) => {
    await deleteBusinessClient(workspaceId, businessId);

    const remaining = businesses.filter((b) => b.id !== businessId);
    setBusinesses(remaining);

    // Never leave the app pointing at a business that no longer exists.
    if (currentBusinessId === businessId) {
      const next = remaining[0]?.id ?? "";
      setCurrentBusinessId(next);
      if (typeof window !== "undefined") {
        if (next) localStorage.setItem(STORAGE_KEY, next);
        else localStorage.removeItem(STORAGE_KEY);
      }
      await Promise.all([loadOffers(next), loadKb(next)]);
    }
  }, [workspaceId, businesses, currentBusinessId, loadOffers, loadKb]);

  const updateCurrentBusiness = useCallback(async (patch: Partial<BusinessDoc>) => {
    if (!currentBusinessId) return null;
    const current = businesses.find((b) => b.id === currentBusinessId);
    if (!current) return null;
    const updated = await saveBusinessClient(workspaceId, {
      ...current,
      ...patch,
      id: currentBusinessId,
      name: patch.name || current.name,
    });
    setBusinesses((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    return updated;
  }, [workspaceId, currentBusinessId, businesses]);

  const reloadOffersHandler = useCallback(async () => {
    if (currentBusinessId) {
      await loadOffers(currentBusinessId);
    }
  }, [currentBusinessId, loadOffers]);

  const reloadKbHandler = useCallback(async () => {
    if (currentBusinessId) {
      await loadKb(currentBusinessId);
    }
  }, [currentBusinessId, loadKb]);

  const currentBusiness = businesses.find((b) => b.id === currentBusinessId) || null;

  return (
    <BusinessContext.Provider
      value={{
        workspaceId,
        businesses,
        currentBusiness,
        currentBusinessId,
        offers,
        knowledgeBase,
        loading,
        switchBusiness,
        createBusiness,
        deleteBusiness,
        updateCurrentBusiness,
        reloadBusinesses,
        reloadOffers: reloadOffersHandler,
        reloadKnowledgeBase: reloadKbHandler,
      }}
    >
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (!context) {
    throw new Error("useBusiness must be used within a BusinessProvider");
  }
  return context;
}
