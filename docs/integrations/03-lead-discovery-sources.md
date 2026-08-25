# Lead Discovery Sources

## Goal

The app must find companies autonomously.

## Recommended Source Priority

### 1. Recherche d'Entreprises / Annuaire des Entreprises

Default free source for French company discovery.

Use for:
- text query discovery
- city/geography discovery
- sector and activity discovery
- company identity
- SIREN/SIRET
- NAF/APE code
- address/city
- activity labels
- source ID and source URL
- deduplication

Respect the documented API surface:
- use textual/geographic search
- use advanced filters such as NAF, postal code, and employee range when supported
- do not assume the API directly returns sales-team headcount
- infer structured sales-force potential with proxy signals before AI research

### 2. Sirene / INSEE

Official validation source for French company and establishment data.

Use for:
- SIREN/SIRET validation
- active/closed status
- NAF/APE code
- legal name
- address and commune/postal code
- creation date
- headquarters/establishment status

### 3. Sirene Stock Files

Future low-cost bulk discovery source from monthly data.gouv.fr stock files.

Use later to:
- download/process large official datasets
- filter locally by city, NAF code, activity, and active status
- avoid expensive API discovery loops

### 4. Google Places API

Optional enrichment for website and local presence if an API key is configured:
- transport company Nantes
- société de maintenance Nantes
- agence immobilière Nantes
- entreprise nettoyage Nantes
- logiciel B2B Nantes

Use carefully and cache results.

Do not depend on it for core discovery.

### 5. Pappers API

Optional premium enrichment only.

Never use Pappers as the default discovery source. Call it only when explicitly enabled, preferably for high-score companies, and with strict monthly limits.

Use for:
- richer structured company details
- SIREN/SIRET confirmation
- legal/activity enrichment
- source URL and raw provider data

### 6. Website Crawling

Use only discovered company websites.

Do not crawl the internet randomly.

Extract:
- title
- meta description
- homepage text
- contact page link
- careers page link
- keywords relevant to Devcomm

### 5. Apollo / Kaspr / LinkedIn

Use later for contact enrichment.

The MVP can discover companies first, then contacts can be enriched manually or by later integrations.

## Compliance

Store source and source URL for every company and contact.

Do not create personal contact records without a clear professional source.

Do not automatically email discovered contacts without approval.
