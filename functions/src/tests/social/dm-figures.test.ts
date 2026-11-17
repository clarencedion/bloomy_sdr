import { describe, expect, it } from "vitest";
import { validateOutreachClaims } from "../../services/claim-validator.js";
import { figuresIn, knownFigures, unverifiedFigures } from "../../services/social/dm-figures.js";

describe("figuresIn — numbers as French and English messages write them", () => {
  it("reads decimals with a comma or a dot, thousands with a space, and plain integers", () => {
    expect(figuresIn("une note de 4,9 sur 1 200 avis, depuis 2015, 4.8/5")).toEqual([4.9, 1200, 2015, 4.8, 5]);
    expect(figuresIn("15 300 abonnés et 2 400 publications")).toEqual([15300, 2400]);
    expect(figuresIn("Bonjour, vos réalisations sont soignées.")).toEqual([]);
  });
});

describe("knownFigures — what the prospect's verified record holds", () => {
  it("numeric facts, and the numbers in the company's own name and town; nothing from low-confidence evidence", () => {
    const known = knownFigures(
      [
        { key: "google_review_count", value: 720, confidence: 90 },
        { key: "copyright_year", value: 2012, confidence: 80 },
        { key: "instagram_followers", value: 9999, confidence: 40 },
        { key: "no_confidence", value: 55 },
        { key: "has_ssl", value: true, confidence: 90 }
      ],
      { name: "Tattoo 13", city: "Paris 10", postalCode: "75010", address: "12 rue des Arts", employeeCount: 4 }
    );
    expect(known.sort((a, b) => a - b)).toEqual([10, 13, 720, 2012]);
  });

  it("the digits of a phone number, a registration number or an address never vouch for a figure (review of 2026-11-11)", () => {
    const known = knownFigures(
      [
        { key: "google_phone_number", value: "05 61 22 33 44", confidence: 90 },
        { key: "social_phone", value: 561223344, confidence: 90 },
        { key: "siren", value: 123456789, confidence: 95 },
        { key: "siret", value: "12345678900012", confidence: 95 },
        { key: "naf_code", value: 9609, confidence: 95 },
        { key: "postal_code", value: 31000, confidence: 95 },
        { key: "address", value: "12 rue des Arts, 31000 Toulouse", confidence: 90 },
        { key: "website_url", value: "https://atelier-22.fr", confidence: 90 },
        { key: "founded", value: "2012-03-01", confidence: 90 },
        { key: "google_rating", value: 4.2, confidence: 90 },
        { key: "google_review_count", value: 112, confidence: 90 },
        { key: "mobile_pagespeed_score", value: 41, confidence: 85 }
      ],
      { name: "Atelier Encre", city: "Toulouse", postalCode: "31000", address: "12 rue des Arts" }
    );
    expect(known.sort((a, b) => a - b)).toEqual([4.2, 41, 112]);

    // What the reviewer's probe let through with that record:
    for (const invented of ["noté 5 sur Google", "vos 12 ans d'expérience", "vos 2 tatoueurs", "depuis 22 ans", "40 créations", "60 clients", "120 abonnés"]) {
      expect(unverifiedFigures(invented, known), invented).not.toEqual([]);
    }
    // Of the integers 1 to 150, only the facts themselves pass.
    const passing = Array.from({ length: 150 }, (_, n) => n + 1).filter((n) => unverifiedFigures(`${n} choses`, known).length === 0);
    expect(passing).toEqual([41, 112]);
  });
});

describe("unverifiedFigures — a figure nobody verified waits for a person", () => {
  const known = [720, 4.92, 5, 2019, 13];

  it("a verified figure passes as written; a rating may be quoted to one decimal", () => {
    expect(unverifiedFigures("note de 4,9, Tattoo 13, en 2019, 720 clients", known)).toEqual([]);
    expect(unverifiedFigures("5 étoiles", known)).toEqual([]);
    expect(unverifiedFigures("une note de 4,5", known)).toEqual(["4.5"]);
  });

  it("no rounding: a number says nothing of what it counts, so it must BE a verified one", () => {
    expect(unverifiedFigures("plus de 700 clients", known)).toEqual(["700"]);
    expect(unverifiedFigures("40 créations", [41])).toEqual(["40"]);
    expect(unverifiedFigures("120 abonnés", [112])).toEqual(["120"]);
    expect(unverifiedFigures("ouvert 7j/7 et 24h/24", known)).toEqual(["7", "24"]);
    expect(unverifiedFigures("14 ans d'expérience", known)).toEqual(["14"]);
    expect(unverifiedFigures("12 tatoueurs", known)).toEqual(["12"]);
    expect(unverifiedFigures("depuis 2008", known)).toEqual(["2008"]);
    expect(unverifiedFigures("depuis 2020", known)).toEqual(["2020"]);
  });

  it("review counts written 'N avis' are the claim validator's to compare (it allows a person's rounding): skipped here", () => {
    expect(unverifiedFigures("note de 4,9 sur plus de 700 avis", known)).toEqual([]);
    expect(unverifiedFigures("près de 1 200 avis et 900 avis", known)).toEqual([]);
    // ...but only the count itself: another figure in the same sentence is still checked.
    expect(unverifiedFigures("700 avis en 3 ans", known)).toEqual(["3"]);
  });

  it("the scale a score is given on is not a figure to verify; the score is", () => {
    expect(unverifiedFigures("noté 4,9/5, soit 4.9 sur 5.", known)).toEqual([]);
    expect(unverifiedFigures("noté 4,2/5", known)).toEqual(["4.2"]);
    expect(unverifiedFigures("un score de 41/100", known)).toEqual(["41"]);
    // "sur 5 ans" is not a scale.
    expect(unverifiedFigures("720 clients sur 5 ans", known)).toEqual([]);
    expect(unverifiedFigures("720 clients sur 6 ans", known)).toEqual(["6"]);
  });

  it("a quantity spelled in words cannot be compared, so it is never verified", () => {
    expect(unverifiedFigures("près de mille avis", known)).toEqual(["mille"]);
    expect(unverifiedFigures("des centaines de clients", known)).toEqual(["centaines"]);
    expect(unverifiedFigures("une dizaine d'artistes", known)).toEqual(["dizaine"]);
    expect(unverifiedFigures("hundreds of reviews", known)).toEqual(["hundreds"]);
    // Not quantities: words that merely contain those letters.
    expect(unverifiedFigures("un accent récent, un centre-ville, excellent", known)).toEqual([]);
  });

  it("with no verified figure at all, every figure is unverified", () => {
    expect(unverifiedFigures("4,9 sur 700 clients", [])).toEqual(["4.9", "700"]);
  });
});

describe("validateOutreachClaims — a rating, as messages phrase it, and nothing that is not one", () => {
  const check = (body: string, rating?: number) =>
    validateOutreachClaims({
      sequence: { body },
      company: { name: "Atelier Encre", city: "Toulouse" },
      evidenceItems: rating === undefined ? [] : ([{ key: "google_rating", value: rating, confidence: 90 }] as never)
    });
  const ratingProblems = (body: string, rating?: number) => check(body, rating).unsupportedClaims.filter((claim) => /Note Google/.test(claim));

  it("reads it after 'note …', after 'noté(e)(s)', before '/5', 'sur 5' and 'étoiles' — and refuses a wrong one", () => {
    for (const body of [
      "Avec une note de 4,9 sur Google, vous êtes une référence.",
      "Avec une note parfaite de 5 sur Google, bravo.",
      "Votre atelier noté 5 sur Google mérite mieux.",
      "Vous êtes notée 4,9/5 par vos clientes.",
      "Vos clients vous donnent 4.8 sur 5.",
      "Avec 294 avis à 5 étoiles, vous êtes une référence."
    ]) {
      expect(ratingProblems(body, 4.2), body).toHaveLength(1);
    }
    for (const body of ["Avec une note de 4,2 sur Google, il y a une marge.", "Votre atelier noté 4,2 sur Google.", "Vous êtes noté 4,3/5."]) {
      expect(ratingProblems(body, 4.2), body).toEqual([]);
    }
    // No verified rating at all: any rating quoted is unsupported.
    expect(ratingProblems("Avec une note de 4,9 sur Google.")).toHaveLength(1);
  });

  it("does not take for a rating what is not one (the email path uses this validator too)", () => {
    for (const body of [
      "Quelques notes : 3 pistes pour votre site.",
      "Une note rapide : 2 minutes suffisent.",
      "J'ai noté vos 3 dernières réalisations.",
      "Un hôtel 4 étoiles comme le vôtre mérite un beau site.",
      "2 sur 5 de vos pages ne s'affichent pas sur mobile.",
      "Nous notons 15 demandes par semaine."
    ]) {
      expect(ratingProblems(body, 4.2), body).toEqual([]);
    }
  });
});
