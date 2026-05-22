// ═══════════════════════════════════════════════════════════════
// JOB SEARCH 2026 — Webhook.gs
// Nouveau fichier à créer dans le projet Apps Script existant
// ═══════════════════════════════════════════════════════════════
//
// PROCÉDURE D'INSTALLATION (une seule fois) :
//
// 1. Dans Apps Script (script.google.com), ouvre ton projet
// 2. Clic "+" à gauche pour créer un nouveau fichier → "Webhook"
// 3. Colle tout ce code, sauvegarde (Cmd+S)
// 4. Clic "Déployer" (bouton bleu) → "Nouveau déploiement"
// 5. Paramètres :
//      Type          → "Application Web"
//      Description   → "Job Search Webhook"
//      Exécuter en   → "Moi (atayac@gmail.com)"
//      Accès         → "Tout le monde"
// 6. Clic "Déployer" → autoriser les permissions si demandé
// 7. Copie l'URL affichée :
//      https://script.google.com/macros/s/XXXXX/exec
//    → colle-la dans WEBHOOK_URL dans index.html
//
// ⚠️  Si tu modifies ce fichier plus tard, fais un NOUVEAU déploiement
//     (pas "Gérer les déploiements" > modifier — ça ne met pas à jour le code)
// ═══════════════════════════════════════════════════════════════

// Secret lu depuis Script Properties
// Clé requise : SHEET_ID (partagée avec Scan.gs dans le même projet Apps Script)
const WH_OFFRES_TAB = "Offres";

function getSheetId() {
  return PropertiesService.getScriptProperties().getProperty("SHEET_ID");
}

// Mapping champ → numéro de colonne (1-based, correspondant au Sheet)
const WH_CHAMPS = {
  "cat_validee":      11,  // K
  "triage_action":    12,  // L
  "suivi_statut":     13,  // M
  "contact":          17,  // Q
  "date_candidature": 19,  // S
  "date_limite":      20,  // T
  "notes_suivi":      21,  // U
  "cv_utilise":       24,  // X
  "date_relance":     25,  // Y
};

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { id, champ, valeur } = payload;

    if (!id || !champ || valeur === undefined) {
      return jsonReponse({ ok: false, erreur: "Paramètres manquants : id, champ, valeur" });
    }

    const col = WH_CHAMPS[champ];
    if (!col) {
      return jsonReponse({ ok: false, erreur: "Champ non autorisé : " + champ });
    }

    const ss    = SpreadsheetApp.openById(getSheetId());
    const sheet = ss.getSheetByName(WH_OFFRES_TAB);
    const data  = sheet.getDataRange().getValues();

    // Chercher la ligne dont la colonne A (index 0) correspond à l'id
    let rowNum = -1;
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][0]).trim() === String(id).trim()) {
        rowNum = r + 1; // +1 car getValues() est 0-based, Sheet est 1-based
        break;
      }
    }

    if (rowNum === -1) {
      return jsonReponse({ ok: false, erreur: "Offre non trouvée : " + id });
    }

    sheet.getRange(rowNum, col).setValue(valeur);
    SpreadsheetApp.flush();

    return jsonReponse({ ok: true, id, champ, valeur, ligne: rowNum });

  } catch (err) {
    return jsonReponse({ ok: false, erreur: err.message });
  }
}

// GET de test — pour vérifier que le webhook est actif
function doGet(e) {
  return jsonReponse({ ok: true, message: "Job Search 2026 webhook actif" });
}

function jsonReponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
