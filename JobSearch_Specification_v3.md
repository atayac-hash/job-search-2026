# Job Search 2026 — Spécification Technique v3
*Document de référence — Mai 2026*

---

## Contexte

Système de centralisation et de suivi des offres d'emploi pour Arnaud Tayac.
Architecture : Gmail → Apps Script → Google Sheets → Page web GitHub Pages.

**Sheet ID :** `1zQCXorQC0CqUV_v9JuCT3dA2hZ-S85u05tK6eabwyIc`
**Label Gmail :** `JobsOffres`
**Déclencheur scan :** timer quotidien 7h-8h
**Interface :** https://atayac-hash.github.io/job-search-2026/
**Stack :** GitHub Pages (HTML statique) + Google Sheets API v4 (lecture) + Apps Script doPost (écriture) + Anthropic API Haiku (scoring IA)

---

## Doc 1 — Types de mails et règles d'extraction

### DIGEST — type principal
**Détection :** corps contient `linkedin.com/comm/jobs/view/` ou `linkedin.com/jobs/view/`
**Offres par mail :** 1 à N

**Format réel d'un bloc LinkedIn dans le corps :**
```
[Titre du poste]
[Entreprise]
[Ville]
[Badges optionnels : "Top candidat", "1 relation", "Postulez avec un CV...", etc.]
Voir l'offre d'emploi : https://www.linkedin.com/comm/jobs/view/[ID]/...
---------------------------------------------------------
```

**Extraction :**
- Chercher les lignes `Voir l'offre d'emploi : URL`
- Remonter en sautant les badges → Titre (L1), Entreprise (L2), Ville (L3)
- `linkedin_job_id` = ID numérique dans l'URL
- `cabinet` = détecté via liste CABINETS_CONNUS sur le **bloc local uniquement** (pas le corps entier — bug corrigé v3.1)
- `salaire` = pattern `Entre X€ et Y€` ou `X k €`

### APPLIED — confirmation candidature
**Détection :** sujet commence par `"Votre candidature"`
**Action :** jobId du corps → `suivi_statut="Postulé"`, `date_candidature=date mail`, `triage_action="en_suivi"`

### IGNORE — parasites
URL brute, < 10 chars, "a été créée", "ont recruté", "Jobs - LinkedIn", etc.

---

## Doc 2 — Schéma de données

### Onglet `Offres` — 25 colonnes (A à Y)

| Col | Champ | Source | Description |
|---|---|---|---|
| A | `id` | Script | Identifiant interne `scan_[timestamp]_[random]` |
| B | `linkedin_job_id` | Script | **Clé primaire déduplication** |
| C | `client` | Script | Entreprise qui recrute |
| D | `cabinet` | Script | Cabinet intermédiaire (détecté sur bloc local) |
| E | `poste` | Script | Titre nettoyé |
| F | `source` | Script | LinkedIn / Autre |
| G | `date_reception` | Script | `YYYY-MM-DD` |
| H | `date_offre` | Script | Publication si connue |
| I | `note` | Script/IA | Note scoring (auto ou `[IA] justification`) |
| J | `cat_auto` | Script | `cible` / `jugement` / `ecarte` (scoring mots-clés) |
| K | `cat_validee` | IA/Manuel | Override scoring — rempli par `scorerViaIA()` ou manuellement |
| L | `triage_action` | Manuel/Web | `en_suivi` / `ecarte_manuel` / vide |
| M | `suivi_statut` | Manuel/Web | Voir valeurs ci-dessous |
| N | `localisation` | Script | Ville |
| O | `taille` | Manuel | Taille entreprise |
| P | `salaire` | Script | Salaire si mentionné |
| Q | `contact` | Manuel/Web | Recruteur/contact |
| R | `lien` | Script | URL LinkedIn |
| S | `date_candidature` | Manuel/Web | `YYYY-MM-DD` |
| T | `date_limite` | Manuel/Web | Deadline `YYYY-MM-DD` |
| U | `notes_suivi` | Manuel/Web | Notes libres |
| V | `doublon_ids` | Script | IDs doublons mergés |
| W | `sources_vues` | Script | Sources vues |
| X | `cv_utilise` | Manuel/Web | `Revenue` / `Ops` / vide |
| Y | `date_relance` | Manuel/Web | Dernière relance `YYYY-MM-DD` |

### Valeurs `suivi_statut`

```
(vide)           → Non triée
"À candidater"   → Shortlistée, candidature à préparer
"Postulé"        → Candidature envoyée
"Entretien"      → Entretien planifié ou passé
"Relancé"        → Relance envoyée
"Sans réponse"   → Délai dépassé, pas de retour
"Refus"          → Retour négatif
```

### Valeurs `triage_action`

```
(vide)           → Non triée
"en_suivi"       → Shortlistée (À candidater ou au-delà)
"ecarte_manuel"  → Écartée manuellement
```

### Priorité scoring — quelle valeur la page web affiche

```
cat_validee remplie → afficher cat_validee  (IA ou manuel)
cat_validee vide    → afficher cat_auto     (mots-clés)
```

### Onglet `Config`

| Clé | Valeur défaut | Description |
|---|---|---|
| `derniere_scan` | `2026-04-01T00:00` | Timestamp dernier scan |
| `seuil_relance` | `10` | Jours sans réponse avant alerte |

---

## Doc 3 — Workflow complet

### Flux quotidien

```
7h — Timer Apps Script
  ↓
scanGmail() — nouveaux mails label:JobsOffres
  ↓
Extraction DIGEST → cat_auto (mots-clés)
  ↓
MANUELLEMENT : scorerViaIA()
  → Appel Claude Haiku par offre sans cat_validee
  → Écrit cat_validee + note [IA] justification
  ↓
Ouvrir https://atayac-hash.github.io/job-search-2026/
  ↓
Vue Triage — filtrer par Cibles
  ↓
  "À candidater" → triage_action="en_suivi", suivi_statut="À candidater"
  "Écarter"      → triage_action="ecarte_manuel"
  ↓
Vue Suivi — travailler la candidature
  ↓
  Renseigner : CV utilisé, contact, notes
  Changer statut : Postulé → Entretien → Relancé → Sans réponse / Refus
```

### Flux triage utilisateur détaillé

```
OFFRE REÇUE (scan)
      ↓
Vue Triage — offre sans statut
      ↓
  "À candidater" → triage_action="en_suivi", suivi_statut="À candidater"
  "Écarter"      → triage_action="ecarte_manuel"
      ↓ (si À candidater)
Vue Suivi — travail de candidature dans projet Agent Emploi (claude.ai)
      ↓
  Renseigner : CV utilisé, contact, notes
      ↓
  Envoyer → suivi_statut="Postulé" + date_candidature
      ↓
  Entretien → Relancé → Sans réponse / Refus
```

### Architecture technique

```
Gmail (label JobsOffres)
  ↓
Apps Script — Scan.gs (timer 7h)
  ↓ scanGmail() : extraction DIGEST/APPLIED/IGNORE
  ↓ scorerViaIA() : appel Anthropic API Haiku, cat_validee
  ↓
Google Sheets (source de vérité)
  ↓ lecture : Sheets API v4 (clé publique)
  ↓ écriture : Apps Script doPost Webhook.gs (URL secrète)
  ↓
GitHub Pages — index.html
  URL : https://atayac-hash.github.io/job-search-2026/
```

### Scoring IA — fonctionnement

**Modèle :** Claude Haiku (claude-haiku-4-5-20251001)
**Coût :** ~0.001 USD par offre. 100 offres ≈ 0.10 USD.
**Contexte transmis par offre :** poste + client + cabinet + localisation + salaire
**Profil de scoring :** extrait du system prompt Agent Emploi (3 profils Revenue/Ops/Business Builder)

**Règles de scoring :**
- `cible` = poste clairement dans la cible (niveau C-suite/VP/MD, périmètre France/EMEA, tech B2B)
- `jugement` = potentiellement pertinent, contexte à vérifier
- `ecarte` = clairement hors cible (niveau intermédiaire, secteur éloigné, périmètre local)

**Titres cibles reconnus :**
CRO, VP Sales, CSO, COO, Managing Director, DG, General Manager, CBO, VP Strategy & BD, VP Partnerships, Country Manager EMEA, Head of Sales EMEA/international

**Titres exclus automatiquement :**
Senior Manager, Account Manager, Territory Manager, Head of Account, Responsable, Coordinateur, Analyst, Engineer, Consultant cabinet, Secteur public administratif, IoT pur

**Nuances clés :**
- "Director" seul → jugement si pertinent, écarté si trop opérationnel
- "Head of Sales" → cible si EMEA/international, jugement si France seule
- Acquisition/reprise entreprise tech → cible (pertinent Profil C)

**Pour re-scorer toutes les offres :**
1. Dans Google Sheets → sélectionner colonne K (`cat_validee`) → Suppr
2. Dans Apps Script → sélectionner `scorerViaIA` → Exécuter

---

## Fichiers du projet

| Fichier | Rôle | Emplacement |
|---|---|---|
| `Scan.gs` | Scan Gmail + scoring IA | Apps Script — projet Job Search 2026 |
| `Webhook.gs` | doPost écriture Sheet | Apps Script — même projet |
| `index.html` | Page web interface | GitHub repo atayac-hash/job-search-2026 |
| `JobSearch_Specification_v3.md` | Ce document | Google Drive Job Search 2026/ |
| `AGENT_EMPLOI_system_prompt_v2.md` | System prompt projet Claude | Google Drive Job Search 2026/ |

---

## Historique des décisions

| Date | Décision | Raison |
|---|---|---|
| Mai 2026 | Google Sheets BDD | Persistance, lisible par Claude |
| Mai 2026 | Apps Script autonome | script.google.com bloqué depuis Claude |
| Mai 2026 | linkedin_job_id clé primaire | Plus fiable que client+poste |
| Mai 2026 | 3 types mails (DIGEST/APPLIED/IGNORE) | Simplification après step-back architecture |
| Mai 2026 | Détection par corps (pas sujet) | Sujet trop fragile (encodage, Fwd, guillemets) |
| Mai 2026 | Backlog hotmail traité manuellement | Coût debug > valeur, cas temporaire |
| Mai 2026 | GitHub Pages pour l'interface | Hors Claude, sans serveur, gratuit |
| Mai 2026 | Apps Script doPost pour écriture | Pas d'OAuth côté client |
| Mai 2026 | Flux : À candidater → Postulé | Sépare shortlist du travail de candidature |
| Mai 2026 | Colonnes X (cv_utilise) Y (date_relance) | Suivi complet post-candidature |
| Mai 2026 | Scoring IA via Anthropic API (Haiku) | Mots-clés insuffisants — contexte entreprise manquant |
| Mai 2026 | cat_validee = scoring IA, cat_auto = fallback | Deux niveaux : pré-tri auto + override IA |
| Mai 2026 | cabinet détecté sur bloc local (fix v3.1) | Bug : premier cabinet du mail appliqué à toutes les offres |
| Mai 2026 | PROFIL_SCORING extrait du system prompt Agent Emploi | Alignement avec le projet de candidature |
