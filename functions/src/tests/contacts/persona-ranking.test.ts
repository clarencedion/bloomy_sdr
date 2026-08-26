import { describe, it, expect } from "vitest";
import { rankContactsForOffer, matchPersona } from "../../services/persona-ranker.js";
import type { OfferDoc } from "../../types/domain.js";

describe("Offer Persona Priority Ranking (REQ-043)", () => {
  const smbOffer: OfferDoc = {
    id: "offer-smb-website",
    workspaceId: "ws-1",
    businessId: "biz-bloomy",
    name: "SMB Website Modernization",
    description: "Modern websites for local businesses and artisans",
    targetPersonas: [
      {
        title: "Dirigeant / Propriétaire",
        priority: 1,
        keywords: ["gérant", "gerant", "fondateur", "artisan", "patron", "propriétaire", "proprietaire", "president", "ceo"]
      },
      {
        title: "Responsable Marketing & Communication",
        priority: 2,
        keywords: ["marketing", "communication", "chargé de com", "community manager"]
      },
      {
        title: "Responsable Commercial",
        priority: 3,
        keywords: ["commercial", "vendeur", "chargé d'affaires"]
      }
    ],
    valuePropositions: ["More local customers", "Mobile friendly design"],
    proofPoints: ["+40% inbound leads"],
    prohibitedPromises: [],
    createdAt: {} as any,
    updatedAt: {} as any
  };

  const enterpriseOffer: OfferDoc = {
    id: "offer-enterprise-consulting",
    workspaceId: "ws-1",
    businessId: "biz-devcomm",
    name: "B2B Sales Acceleration Consulting",
    description: "Sales performance consulting for corporate B2B sales teams",
    targetPersonas: [
      {
        title: "Directeur Commercial / Head of Sales",
        priority: 1,
        keywords: ["directeur commercial", "directrice commerciale", "sales director", "head of sales", "vp sales", "vp of sales"]
      },
      {
        title: "Direction Générale",
        priority: 2,
        keywords: ["directeur général", "directrice générale", "dg", "ceo", "président", "president", "gérant"]
      },
      {
        title: "Direction des Ressources Humaines / Formation",
        priority: 3,
        keywords: ["drh", "directeur rh", "responsable formation", "talent development"]
      }
    ],
    valuePropositions: ["Shorter sales cycles", "Higher quota attainment"],
    proofPoints: ["+35% revenue growth in 6 months"],
    prohibitedPromises: [],
    createdAt: {} as any,
    updatedAt: {} as any
  };

  it("prioritizes Gérant (P1) over Responsable Marketing (P2) for SMB Offer", () => {
    const candidates = [
      {
        id: "c1",
        fullName: "Sophie Laurent",
        role: "Responsable Marketing & Digital",
        email: "sophie@fleurs-nantes.fr",
        emailVerified: true
      },
      {
        id: "c2",
        fullName: "Pierre Dubois",
        role: "Gérant Propriétaire",
        email: "pierre@fleurs-nantes.fr",
        emailVerified: true
      },
      {
        id: "c3",
        fullName: "Marc Simon",
        role: "Attaché Commercial",
        email: "marc@fleurs-nantes.fr",
        emailVerified: true
      }
    ];

    const ranked = rankContactsForOffer(candidates, smbOffer);

    expect(ranked.length).toBe(3);
    // Pierre Dubois (Gérant) should be Priority 1 and primary decision maker
    expect(ranked[0].fullName).toBe("Pierre Dubois");
    expect(ranked[0].personaPriority).toBe(1);
    expect(ranked[0].personaMatched).toBe("Dirigeant / Propriétaire");
    expect(ranked[0].isPrimaryDecisionMaker).toBe(true);

    // Sophie Laurent (Marketing) should be Priority 2
    expect(ranked[1].fullName).toBe("Sophie Laurent");
    expect(ranked[1].personaPriority).toBe(2);
    expect(ranked[1].personaMatched).toBe("Responsable Marketing & Communication");
    expect(ranked[1].isPrimaryDecisionMaker).toBe(false);

    // Marc Simon (Commercial) should be Priority 3
    expect(ranked[2].fullName).toBe("Marc Simon");
    expect(ranked[2].personaPriority).toBe(3);
    expect(ranked[2].isPrimaryDecisionMaker).toBe(false);
  });

  it("prioritizes Directeur Commercial (P1) over Gérant/DG (P2) for Enterprise Consulting Offer", () => {
    const candidates = [
      {
        id: "c1",
        fullName: "Alexandre Martin",
        role: "Président Directeur Général",
        email: "alexandre@corp-logistics.com",
        emailVerified: true
      },
      {
        id: "c2",
        fullName: "Élodie Renaud",
        role: "Directeur Commercial France",
        email: "elodie@corp-logistics.com",
        emailVerified: true
      }
    ];

    const ranked = rankContactsForOffer(candidates, enterpriseOffer);

    expect(ranked.length).toBe(2);
    // Élodie Renaud (Directeur Commercial) should be Priority 1 for Enterprise Offer
    expect(ranked[0].fullName).toBe("Élodie Renaud");
    expect(ranked[0].personaPriority).toBe(1);
    expect(ranked[0].personaMatched).toBe("Directeur Commercial / Head of Sales");
    expect(ranked[0].isPrimaryDecisionMaker).toBe(true);

    // Alexandre Martin (PDG) should be Priority 2
    expect(ranked[1].fullName).toBe("Alexandre Martin");
    expect(ranked[1].personaPriority).toBe(2);
    expect(ranked[1].personaMatched).toBe("Direction Générale");
    expect(ranked[1].isPrimaryDecisionMaker).toBe(false);
  });

  it("breaks ties between candidates of same priority using email verification and match score", () => {
    const candidates = [
      {
        id: "c1",
        fullName: "Luc Dupont",
        role: "Co-gérant associé",
        email: "luc@artisan.fr",
        emailVerified: false // Unverified
      },
      {
        id: "c2",
        fullName: "Antoine Moreau",
        role: "Gérant Fondateur",
        email: "antoine@artisan.fr",
        emailVerified: true // Verified
      }
    ];

    const ranked = rankContactsForOffer(candidates, smbOffer);

    expect(ranked[0].fullName).toBe("Antoine Moreau");
    expect(ranked[0].emailVerified).toBe(true);
    expect(ranked[0].isPrimaryDecisionMaker).toBe(true);
    expect(ranked[1].fullName).toBe("Luc Dupont");
  });

  it("matches personas with accented characters and case variations gracefully", () => {
    const match1 = matchPersona("PRESIDENT DIRECTEUR GENERAL", smbOffer.targetPersonas);
    expect(match1.matchedPersona?.title).toBe("Dirigeant / Propriétaire");
    expect(match1.matchScore).toBeGreaterThanOrEqual(80);

    const match2 = matchPersona("vice president of sales", enterpriseOffer.targetPersonas);
    expect(match2.matchedPersona?.title).toBe("Directeur Commercial / Head of Sales");
    expect(match2.matchScore).toBeGreaterThanOrEqual(80);
  });
});
