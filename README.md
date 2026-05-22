# Job Search 2026 — Documentation technique

## Architecture

```
Gmail (label JobsOffres)
        ↓
Apps Script (timer 7h)
  ├── Scan.gs      → scan + extraction + scoring IA
  └── Webhook.gs   → écriture Sheet depuis la page web
        ↓
Google Sheet (source de vérité données)
  URL : https://docs.google.com/spreadsheets/d/1zQCXorQC0CqUV_v9JuCT3dA2hZ-S85u05tK6eabwyIc
        ↓
GitHub Pages (interface utilisateur)
  URL : https://atayac-hash.github.io/job-search-2026/
```

## Fichiers du repo

| Fichier | Rôle | Versionné |
|---|---|---|
| `index.html` | Page web — triage + suivi | ✅ GitHub |
| `config.template.js` | Template configuration (sans valeurs) | ✅ GitHub |
| `config.js` | Configuration locale avec vraies valeurs | ❌ .gitignore |
| `Scan.gs` | Script Apps Script — scan Gmail | ✅ GitHub |
| `Webhook.gs` | Script Apps Script — écriture Sheet | ✅ GitHub |
| `.gitignore` | Fichiers exclus du versionnement | ✅ GitHub |
| `docs/JobSearch_Specification_v3.md` | Specs techniques | ✅ GitHub |
| `docs/Agent_Emploi_system_prompt_v2.md` | System prompt Claude | ✅ GitHub |
| `README.md` | Ce fichier | ✅ GitHub |

---

## Installation initiale (une seule fois)

### 1. Clé API Google Sheets (lecture publique)

1. Aller sur https://console.cloud.google.com
2. Créer un projet → **APIs et services → Bibliothèque → Google Sheets API → Activer**
3. **APIs et services → Identifiants → Créer des identifiants → Clé API**
4. Copier la clé (`AIzaSy...`)
5. Restreindre la clé : APIs autorisées = Google Sheets API

### 2. Google Sheet — partage public en lecture

1. Ouvrir le Sheet
2. **Partager → Accès général → Toute personne disposant du lien → Lecteur**

### 3. Apps Script — Script Properties (secrets)

Dans Apps Script → **Paramètres du projet → Propriétés de script → Ajouter** :

| Clé | Valeur |
|---|---|
| `SHEET_ID` | `1zQCXorQC0CqUV_v9JuCT3dA2hZ-S85u05tK6eabwyIc` |
| `CLAUDE_API_KEY` | `sk-ant-...` (depuis console.anthropic.com) |

Ces valeurs sont lues automatiquement par `Scan.gs` et `Webhook.gs`. **À ne configurer qu'une seule fois** — elles persistent même si tu mets à jour le code.

### 4. Apps Script — Webhook (déploiement Web App)

1. Ouvrir Apps Script → onglet `Webhook.gs`
2. **Déployer → Nouveau déploiement**
   - Type : Application Web
   - Exécuter en tant que : Moi
   - Accès : Tout le monde
3. Copier l'URL (`https://script.google.com/macros/s/XXXXX/exec`)
4. → Coller dans `config.js` (valeur `WEBHOOK_URL`)

### 5. Apps Script — Timer quotidien

1. Apps Script → **Déclencheurs (horloge)** → Ajouter un déclencheur
2. Fonction : `scanGmail`
3. Événement : **Déclencheur basé sur le temps → Quotidien → Entre 7h et 8h**

### 6. Configuration locale (config.js)

```bash
cp config.template.js config.js
# Éditer config.js avec les vraies valeurs
```

```javascript
const CONFIG = {
  SHEET_ID:    "1zQCXorQC0CqUV_v9JuCT3dA2hZ-S85u05tK6eabwyIc",
  API_KEY:     "AIzaSy...",        // clé étape 1
  WEBHOOK_URL: "https://script.google.com/macros/s/.../exec",  // URL étape 4
  SEUIL_RELANCE: 10
};
```

### 7. GitHub Pages

1. GitHub → repo → **Settings → Pages → Branch: main / root → Save**
2. URL disponible après 1-2 min : `https://atayac-hash.github.io/job-search-2026/`

---

## Mise à jour du code (workflow quotidien)

### Modifier Scan.gs ou Webhook.gs

```
1. Modifier le fichier .gs dans ce repo (GitHub ou éditeur local)
2. Copier l'intégralité du fichier
3. Apps Script → onglet correspondant → Sélectionner tout → Coller → Sauvegarder (Cmd+S)
4. ⚠️ Si Webhook.gs modifié : Déployer → Nouveau déploiement → copier la nouvelle URL → mettre à jour config.js
```

> **Note :** les Script Properties (SHEET_ID, CLAUDE_API_KEY) ne sont pas affectées par la mise à jour du code. Tu n'as jamais à les recopier.

### Modifier index.html

```
1. Modifier index.html dans ce repo
2. git add index.html && git commit -m "description" && git push
3. GitHub Pages se met à jour automatiquement en 1-2 min
4. ⚠️ config.js reste intact sur ta machine — rien à recopier
```

### Ajouter un nouveau déploiement Webhook

Uniquement si tu modifies la logique de `doPost` dans Webhook.gs :
```
1. Mettre à jour Webhook.gs dans Apps Script
2. Déployer → Nouveau déploiement (pas "Modifier" — ça ne recharge pas le code)
3. Copier la nouvelle URL
4. Mettre à jour WEBHOOK_URL dans config.js
```

---

## Scorer via IA (manuel, après chaque scan)

1. Apps Script → Sélectionner `scorerViaIA` dans le menu → Exécuter
2. Coût : ~0.001 USD / offre (Claude Haiku)
3. Résultat : colonne K (`cat_validee`) + colonne I (`note [IA] justification`)

**Pour re-scorer toutes les offres :**
- Google Sheet → Sélectionner colonne K → Suppr
- Relancer `scorerViaIA`

---

## Résolution de problèmes

| Symptôme | Cause probable | Solution |
|---|---|---|
| Page blanche au chargement | `config.js` absent ou mal rempli | Vérifier `config.js` existe et contient les bonnes valeurs |
| "API key not valid" | Clé API Google invalide ou Sheets API non activée | Vérifier Google Cloud Console |
| Boutons sans effet | Webhook URL incorrecte dans `config.js` | Vérifier `WEBHOOK_URL` dans `config.js` et le déploiement Apps Script |
| `scorerViaIA` : "CLAUDE_API_KEY non configurée" | Script Properties non remplies | Apps Script → Paramètres → Propriétés de script |
| Scan ne tourne pas | Timer supprimé ou quota Gmail dépassé | Vérifier les déclencheurs Apps Script |

---

## Modèle réplicable (Agent Reprise, autres projets)

Ce repo suit un pattern standard applicable à tout projet similaire :

```
repo/
├── index.html              # Interface web
├── config.template.js      # Template public sans secrets
├── config.js               # Secrets locaux (gitignored)
├── .gitignore              # Exclut config.js
├── [NomScript].gs          # Script(s) Apps Script (secrets via Properties)
├── README.md               # Ce fichier
└── docs/                   # Spécifications et system prompts
```

**Secrets :**
- Côté Apps Script → `PropertiesService.getScriptProperties()`
- Côté web → `config.js` local (non versionné)
- Jamais en dur dans le code versionné
