// ═════════════════════════════════════════════════════════════════
// JOB SEARCH 2026 — Scan.gs
// Version 3.1 — Fix cabinet + Scoring IA via API Claude
// ═════════════════════════════════════════════════════════════════
//
// CE FICHIER REMPLACE ENTIEREMENT l'ancien Scan.gs dans Apps Script.
//
// NOUVEAUTES v3.1 :
//   - Bug cabinet corrige (utilisait le corps entier au lieu du bloc local)
//   - Fonction scorerViaIA() : appelle l'API Claude pour scorer les offres
//     sans cat_validee. A lancer manuellement apres un scan.
//
// POUR OBTENIR UNE CLE API CLAUDE :
//   1. Va sur https://console.anthropic.com
//   2. Cree un compte (ou connecte-toi)
//   3. Menu gauche : "API Keys" -> "Create Key"
//   4. Copie la cle (commence par sk-ant-...)
//   5. Colle-la dans CLAUDE_API_KEY ci-dessous
//   Note : l'API est payante au token. Haiku coute ~0.001 USD par offre.
//   100 offres = environ 0.10 USD.
//
// DEPLOIEMENT :
//   - Ce fichier remplace Scan.gs (pas Webhook.gs qui reste intact)
//   - Pas besoin de nouveau deploiement Web App pour ce fichier
//   - Le timer existant (scanGmail a 7h) continue de fonctionner
//   - scorerViaIA() se lance manuellement depuis l'editeur Apps Script
// ═════════════════════════════════════════════════════════════════

// Secrets lus depuis Script Properties (jamais en dur dans le code)
// Configuration : Apps Script → Paramètres du projet → Propriétés de script
// Clés requises : SHEET_ID, CLAUDE_API_KEY
// Valeurs fixes (non secrètes, peuvent rester ici)
const OFFRES_TAB     = "Offres";
const CONFIG_TAB     = "Config";
const LABEL          = "JobsOffres";

function getConfig() {
  var props = PropertiesService.getScriptProperties();
  return {
    SHEET_ID:      props.getProperty("SHEET_ID"),
    CLAUDE_API_KEY: props.getProperty("CLAUDE_API_KEY")
  };
}

const COLS = [
  "id","linkedin_job_id","client","cabinet","poste","source","date_reception","date_offre","note","cat_auto","cat_validee","triage_action","suivi_statut","localisation","taille","salaire","contact","lien","date_candidature","date_limite","notes_suivi","doublon_ids","sources_vues","cv_utilise","date_relance"
];

const MOTS_CIBLE = [
  "cro","coo","cco","cso","ceo",
  "chief revenue","chief operating","chief commercial","chief sales",
  "chief business","chief growth","chief executive",
  "vp sales","vp commercial","vp business",
  "managing director","general manager","country manager",
  "directeur general","directeur des ventes",
  "business director","revenue officer"
];

const MOTS_ECARTE = [
  "senior manager","account manager","territory manager",
  "head of account","responsable","coordinateur","coordinatrice",
  "assistant","assistante","analyst","analyste","engineer","ingenieur",
  "responsable pays"
];

const CABINETS_CONNUS = [
  "heidrick","korn ferry","spencer stuart","michael page","robert half",
  "selescope","altaide","grant alexander","maesina","keyman","dsj global",
  "bluebird","hunton","vesterling","keller","blue search","bras droit",
  "thexton","atlays","bellevue rh","worldwiders","ffp international"
];

// Profil Arnaud - extrait du system prompt Agent Emploi, optimise pour le pre-tri
const PROFIL_SCORING = "Tu es un assistant de recrutement expert. Ta seule tache : evaluer si cette offre vaut le temps d'Arnaud Tayac (oui=cible, peut-etre=jugement, non=ecarte).\n\nPROFIL CANDIDAT :\nArnaud Tayac, 25+ ans tech B2B. Ex-Managing Director France UnaBiz/Sigfox (IoT, connectivite). Bilingue FR/EN.\nExpertise : go-to-market, P&L ownership, turnaround, business development B2B enterprise, creation de marches.\n\nPOSTES CIBLES (les 3 profils convergent sur le niveau) :\n- Revenue : CRO, VP Sales, CSO, Chief Sales Officer, Head of Sales EMEA\n- Ops/Direction : COO, Managing Director, DG, General Manager EMEA\n- Business Builder : CBO, VP Strategy & BD, VP Partnerships & Growth\nCommun : perimetre France ou EMEA, entreprise tech ou transformation tech, 50-2000 personnes.\nSalaire fixe minimum : 110K EUR. Package cible : 180-220K EUR.\n\nA ECARTES SYSTEMATIQUEMENT :\n- Titres : Senior Manager, Account Manager, Territory Manager, Head of Account, Responsable, Coordinateur, Analyst, Engineer, Consultant (cabinet)\n- Secteurs : sans lien tech B2B, perimetre purement local ou regional\n- Niveau : management intermediaire sans P&L ni scope international\n- IoT pur (trop proche Sigfox/UnaBiz)\n- Secteur public administratif (DGS collectivite, agence gouvernementale)\n\nNUANCES IMPORTANTES :\n- 'Director' seul (sans VP/Chief) = jugement si pertinent, ecarte si trop operationnel\n- 'Head of Sales' = cible si scope EMEA/international, jugement si France seule, ecarte si regional\n- Secteurs eloignes (mode, agroalimentaire, pharma specialise) = jugement si niveau C-suite confirme\n- Acquisition/reprise entreprise tech = cible (pertinent projet Profil C)\n\nReponds UNIQUEMENT avec un JSON sur une seule ligne, sans markdown ni explication :\n{\"score\":\"cible\",\"justification\":\"raison en 8 mots max\"}\nou {\"score\":\"jugement\",\"justification\":\"raison en 8 mots max\"}\nou {\"score\":\"ecarte\",\"justification\":\"raison en 8 mots max\"}";

// ═════════════════════════════════════════════════════════════════
// SCAN GMAIL
// ═════════════════════════════════════════════════════════════════

function scanGmail() {
  var cfg           = getConfig();
  const ss          = SpreadsheetApp.openById(cfg.SHEET_ID);
  const configSheet = ss.getSheetByName(CONFIG_TAB);
  const offresSheet = ss.getSheetByName(OFFRES_TAB);

  const config      = lireConfig(configSheet);
  const dernierScan = config["derniere_scan"] || "2026-04-01T00:00";
  const dateDepart  = new Date(dernierScan);
  const dateGmail   = Utilities.formatDate(dateDepart, "UTC", "yyyy/MM/dd");

  Logger.log("SCAN DEMARRE depuis : " + dernierScan);

  const threads = GmailApp.search("label:" + LABEL + " after:" + dateGmail, 0, 500);
  Logger.log("Threads trouves : " + threads.length);

  if (threads.length === 0) {
    ecrireConfig(configSheet, "derniere_scan", formatDateISO(new Date()));
    return { inserted: 0, merged: 0, ignored: 0, statuts: 0 };
  }

  const index = construireIndex(offresSheet);
  var inserted = 0, merged = 0, ignored = 0, statuts = 0;

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(message) {
      if (message.getDate() <= dateDepart) return;

      var sujetBrut = message.getSubject() || "";
      var from      = message.getFrom() || "";
      var corps     = message.getPlainBody() || "";
      var date      = message.getDate();
      var sujet     = sujetBrut.replace(/^(Fwd|Tr|Re|Fw)\s*:\s*/i, "").trim();

      var type = identifierType(sujet, corps);
      Logger.log("[" + type + "] " + sujet.substring(0, 65));

      if (type === "IGNORE") { ignored++; return; }

      if (type === "APPLIED") {
        if (traiterApplied(offresSheet, index, corps, date)) statuts++;
        return;
      }

      var offres = extraireOffresDigest(sujet, from, corps, date);
      offres.forEach(function(offre) {
        var result = upsertOffre(offresSheet, index, offre);
        if (result === "inserted") inserted++;
        else if (result === "merged") merged++;
      });
    });
  });

  ecrireConfig(configSheet, "derniere_scan", formatDateISO(new Date()));

  Logger.log("RESUME - Inserees: " + inserted + " | Mergees: " + merged + " | Ignorees: " + ignored + " | Statuts: " + statuts);
  return { inserted: inserted, merged: merged, ignored: ignored, statuts: statuts };
}

// ═════════════════════════════════════════════════════════════════
// SCORING IA
// ═════════════════════════════════════════════════════════════════

function scorerViaIA() {
  var cfg = getConfig();
  if (!cfg.CLAUDE_API_KEY) {
    Logger.log("ERREUR : CLAUDE_API_KEY non configuree dans Script Properties.");
    return;
  }

  var ss    = SpreadsheetApp.openById(cfg.SHEET_ID);
  var sheet = ss.getSheetByName(OFFRES_TAB);
  var data  = sheet.getDataRange().getValues();

  var iPoste      = COLS.indexOf("poste");
  var iClient     = COLS.indexOf("client");
  var iCabinet    = COLS.indexOf("cabinet");
  var iLoc        = COLS.indexOf("localisation");
  var iSalaire    = COLS.indexOf("salaire");
  var iCatValidee = COLS.indexOf("cat_validee");
  var iNote       = COLS.indexOf("note");
  var iTriage     = COLS.indexOf("triage_action");

  var scored = 0, skipped = 0, errors = 0;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];

    // Sauter si deja score ou ecarte manuellement
    if (row[iCatValidee]) { skipped++; continue; }
    if (row[iTriage] === "ecarte_manuel") { skipped++; continue; }

    var poste   = row[iPoste]   || "";
    var client  = row[iClient]  || "";
    var cabinet = row[iCabinet] || "";
    var loc     = row[iLoc]     || "";
    var salaire = row[iSalaire] || "";

    if (!poste || poste.length < 3) { skipped++; continue; }

    var lignes = ["Poste : " + poste];
    if (client && client !== "A confirmer")  lignes.push("Entreprise : " + client);
    if (cabinet)  lignes.push("Cabinet : " + cabinet);
    if (loc)      lignes.push("Localisation : " + loc);
    if (salaire)  lignes.push("Salaire : " + salaire);
    var prompt = lignes.join("\n");

    try {
      var result = appellerClaude(prompt, cfg.CLAUDE_API_KEY);
      if (result) {
        var rowNum = r + 1;
        sheet.getRange(rowNum, iCatValidee + 1).setValue(result.score);
        sheet.getRange(rowNum, iNote + 1).setValue("[IA] " + result.justification);
        scored++;
        Logger.log("  [" + result.score + "] " + client + " / " + poste + " - " + result.justification);
        Utilities.sleep(600); // rate limit
      }
    } catch(e) {
      errors++;
      Logger.log("  ERREUR : " + client + " / " + poste + " - " + e.message);
    }
  }

  Logger.log("SCORING IA - Scores: " + scored + " | Skipped: " + skipped + " | Erreurs: " + errors);
}

function appellerClaude(promptOffre, CLAUDE_API_KEY) {
  var payload = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 120,
    system: PROFIL_SCORING,
    messages: [{ role: "user", content: promptOffre }]
  };

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": cfg.CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", options);
  var code     = response.getResponseCode();
  var body     = JSON.parse(response.getContentText());

  if (code !== 200) {
    throw new Error("API " + code + ": " + (body.error ? body.error.message : "Erreur inconnue"));
  }

  var text = body.content[0].text.trim();

  try {
    var parsed = JSON.parse(text);
    if (parsed.score && (parsed.score === "cible" || parsed.score === "jugement" || parsed.score === "ecarte")) {
      return { score: parsed.score, justification: parsed.justification || "" };
    }
  } catch(e) {
    var m = text.match(/"score"\s*:\s*"(cible|jugement|ecarte)"/);
    if (m) return { score: m[1], justification: "" };
  }

  throw new Error("Reponse inattendue : " + text.substring(0, 100));
}

// ═════════════════════════════════════════════════════════════════
// IDENTIFICATION
// ═════════════════════════════════════════════════════════════════

function identifierType(sujet, corps) {
  var s = sujet.toLowerCase().trim();
  if (s.indexOf("http") === 0) return "IGNORE";
  if (s.length < 10) return "IGNORE";
  if (s.indexOf("a ete creee") >= 0 || s.indexOf("a \u00e9t\u00e9 cr\u00e9\u00e9e") >= 0) return "IGNORE";
  if (s.indexOf("ont recrut\u00e9") >= 0 || s.indexOf("ont recrute") >= 0) return "IGNORE";
  if (s.indexOf("qui a recrut\u00e9") >= 0) return "IGNORE";
  if (s.indexOf("career insight") >= 0) return "IGNORE";
  if (s === "jobs" || s === "linkedin" || s === "jobs - linkedin") return "IGNORE";
  if (s.indexOf("nouveau message") >= 0) return "IGNORE";
  if (s.indexOf("votre candidature") === 0) return "APPLIED";
  if (corps.indexOf("linkedin.com/comm/jobs/view/") >= 0 || corps.indexOf("linkedin.com/jobs/view/") >= 0) return "DIGEST";
  return "IGNORE";
}

// ═════════════════════════════════════════════════════════════════
// EXTRACTION DIGEST
// ═════════════════════════════════════════════════════════════════

function extraireOffresDigest(sujet, from, corps, date) {
  var offres = [];
  var lignes = corps.split(/\r?\n/);
  var jobIdsVus = {};

  var badgesAIgnorer = [
    "top candidat","candidature simplifi","correspondance des comp","postulez avec un cv","recrutement actif","croissance rapide","cette entreprise recrute","voir l'offre","voir l offre"
  ];

  function estBadge(ligne) {
    var l = ligne.toLowerCase().trim();
    for (var b = 0; b < badgesAIgnorer.length; b++) {
      if (l.indexOf(badgesAIgnorer[b]) >= 0) return true;
    }
    if (l.match(/^\d+\s+(relation|candidat|postulant|ancien)/)) return true;
    if (l.match(/^\[.+\]$/)) return true;
    return false;
  }

  for (var i = 0; i < lignes.length; i++) {
    var ligne = lignes[i].trim();
    var urlMatch = ligne.match(/[Vv]oir.+?:\s*(https?:\/\/(?:www\.)?linkedin\.com\/comm\/jobs\/view\/(\d+)[^\s]*)/);
    if (!urlMatch) continue;

    var lien  = urlMatch[1];
    var jobId = urlMatch[2];

    if (jobIdsVus[jobId]) continue;
    jobIdsVus[jobId] = true;

    var blocLignes = [];
    for (var j = i - 1; j >= 0 && j >= i - 10; j--) {
      var prev = lignes[j].trim();
      if (!prev) {
        if (blocLignes.length >= 3) break;
        continue;
      }
      if (prev.match(/^-{5,}$/)) break;
      if (prev.match(/[Vv]oir.+?:\s*https?/)) break;
      if (prev.indexOf("http") === 0) continue;
      if (estBadge(prev)) continue;
      blocLignes.unshift(prev);
      if (blocLignes.length >= 4) break;
    }

    if (blocLignes.length < 2) continue;

    var poste        = nettoyerPoste(blocLignes[0]);
    var client       = blocLignes.length >= 2 ? nettoyerClient(blocLignes[1]) : "A confirmer";
    var localisation = blocLignes.length >= 3 ? blocLignes[2].replace(/\(.*?\)/g, "").trim() : "";

    if (!poste || poste.length < 3) continue;

    // FIX CABINET : utiliser seulement le bloc local, pas le corps entier
    var blocTexte = blocLignes.join(" ");
    var cabinet   = detecterCabinet(blocTexte, blocTexte, from);
    var source    = detecterSource(from);
    var cat_auto  = scorer(poste);

    offres.push({
      id: "scan_" + date.getTime() + "_" + Math.random().toString(36).slice(2, 6),
      linkedin_job_id: jobId,
      client: (cabinet && estCabinet(client)) ? "A confirmer" : client,
      cabinet: cabinet ? capitaliser(cabinet) : "",
      poste: poste,
      source: source,
      date_reception: formatDateISO(date).slice(0, 10),
      date_offre: extraireDateOffre(corps),
      note: genererNote(cat_auto, cabinet ? "Cabinet " + capitaliser(cabinet) : client),
      cat_auto: cat_auto,
      cat_validee: "", triage_action: "", suivi_statut: "",
      localisation: localisation, taille: "", salaire: extraireSalaire(corps),
      contact: "", lien: lien,
      date_candidature: "", date_limite: "", notes_suivi: "",
      doublon_ids: "", sources_vues: source,
      cv_utilise: "", date_relance: ""
    });
  }

  Logger.log("  -> " + offres.length + " offres extraites");
  return offres;
}

// ═════════════════════════════════════════════════════════════════
// APPLIED
// ═════════════════════════════════════════════════════════════════

function traiterApplied(sheet, index, corps, date) {
  var jobId = extraireJobId(corps);
  if (!jobId) return false;
  var iStatut   = COLS.indexOf("suivi_statut");
  var iDateCand = COLS.indexOf("date_candidature");
  var iTriage   = COLS.indexOf("triage_action");
  if (index["jid:" + jobId]) {
    var rowNum = index["jid:" + jobId].row;
    sheet.getRange(rowNum, iStatut + 1).setValue("Postule");
    sheet.getRange(rowNum, iDateCand + 1).setValue(formatDateISO(date).slice(0, 10));
    sheet.getRange(rowNum, iTriage + 1).setValue("en_suivi");
    return true;
  }
  return false;
}

// ═════════════════════════════════════════════════════════════════
// UPSERT
// ═════════════════════════════════════════════════════════════════

function upsertOffre(sheet, index, offre) {
  if (offre.linkedin_job_id) {
    var key = "jid:" + offre.linkedin_job_id;
    if (index[key]) {
      mergerDoublon(sheet, index[key].row, offre.source, offre.id);
      Logger.log("  Doublon (jobId) : " + offre.client + " / " + offre.poste);
      return "merged";
    }
  }
  var keyCP = normaliser(offre.client) + "|" + normaliser(offre.poste);
  if (index[keyCP]) {
    mergerDoublon(sheet, index[keyCP].row, offre.source, offre.id);
    return "merged";
  }
  var newRow = COLS.map(function(col) { return offre[col] !== undefined ? offre[col] : ""; });
  sheet.appendRow(newRow);
  var rowNum = sheet.getLastRow();
  if (offre.linkedin_job_id) index["jid:" + offre.linkedin_job_id] = { row: rowNum, id: offre.id };
  index[keyCP] = { row: rowNum, id: offre.id };
  Logger.log("  Inseree [" + offre.cat_auto + "] : " + offre.client + " / " + offre.poste);
  return "inserted";
}

// ═════════════════════════════════════════════════════════════════
// INDEX & MERGE
// ═════════════════════════════════════════════════════════════════

function construireIndex(sheet) {
  var data  = sheet.getDataRange().getValues();
  var index = {};
  var iId     = COLS.indexOf("id");
  var iJobId  = COLS.indexOf("linkedin_job_id");
  var iClient = COLS.indexOf("client");
  var iPoste  = COLS.indexOf("poste");
  for (var r = 1; r < data.length; r++) {
    var row = data[r]; var rowNum = r + 1;
    if (row[iJobId]) index["jid:" + row[iJobId]] = { row: rowNum, id: row[iId] };
    index[normaliser(row[iClient]) + "|" + normaliser(row[iPoste])] = { row: rowNum, id: row[iId] };
  }
  return index;
}

function mergerDoublon(sheet, rowNum, source, newId) {
  var iSources = COLS.indexOf("sources_vues") + 1;
  var iDoublon = COLS.indexOf("doublon_ids") + 1;
  var sCell = sheet.getRange(rowNum, iSources);
  var dCell = sheet.getRange(rowNum, iDoublon);
  var sources  = sCell.getValue() ? sCell.getValue().split(",").map(function(s){return s.trim();}) : [];
  var doublons = dCell.getValue() ? dCell.getValue().split(",").map(function(s){return s.trim();}) : [];
  if (source && sources.indexOf(source) < 0)        { sources.push(source);    sCell.setValue(sources.join(", ")); }
  if (newId  && doublons.indexOf(String(newId)) < 0) { doublons.push(String(newId)); dCell.setValue(doublons.join(", ")); }
}

// ═════════════════════════════════════════════════════════════════
// SCORING MOTS-CLES (fallback)
// ═════════════════════════════════════════════════════════════════

function scorer(poste) {
  var p = normaliser(poste);
  for (var i = 0; i < MOTS_ECARTE.length; i++) { if (p.indexOf(normaliser(MOTS_ECARTE[i])) >= 0) return "ecarte"; }
  for (var j = 0; j < MOTS_CIBLE.length; j++)  { if (p.indexOf(normaliser(MOTS_CIBLE[j]))  >= 0) return "cible"; }
  return "jugement";
}

function genererNote(cat, qui) {
  if (cat === "cible")    return qui + " - Scoring auto : dans la cible.";
  if (cat === "jugement") return qui + " - Scoring auto : a juger.";
  if (cat === "ecarte")   return qui + " - Scoring auto : ecarte.";
  return "";
}

// ═════════════════════════════════════════════════════════════════
// UTILITAIRES
// ═════════════════════════════════════════════════════════════════

function extraireJobId(corps) {
  var m = corps.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/);
  return m ? m[1] : "";
}

function extraireDateOffre(corps) {
  var m = corps.match(/[Pp]ubli.+?:\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
  if (!m) return "";
  var parts = m[1].split(/[\/\-\.]/);
  if (parts.length !== 3) return "";
  var j = parts[0], mo = parts[1], a = parts[2];
  return (a.length === 2 ? "20" + a : a) + "-" + mo.padStart(2,"0") + "-" + j.padStart(2,"0");
}

function extraireSalaire(texte) {
  var patterns = [
    /[Ee]ntre\s+(\d+)\s*[kK][^e]*et\s+(\d+)\s*[kK]/,
    /(\d{2,3})\s*[kK]\s*[-]\s*(\d{2,3})\s*[kK]/,
    /[Ss]alaire\s*[:\s]+(\d{2,3}\s*[kK])/i,
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = texte.match(patterns[i]);
    if (m) {
      var num = parseInt(m[1]);
      if (num >= 50 && num <= 500) return m[0].trim().replace(/\s+/g, " ");
    }
  }
  return "";
}

function detecterSource(from) {
  var f = from.toLowerCase();
  if (f.indexOf("linkedin") >= 0 || f.indexOf("jobalerts") >= 0 || f.indexOf("jobs-noreply") >= 0 || f.indexOf("jobs-listings") >= 0) return "LinkedIn";
  if (f.indexOf("indeed") >= 0)     return "Indeed";
  if (f.indexOf("apec") >= 0)       return "APEC";
  if (f.indexOf("cadremploi") >= 0) return "Cadremploi";
  return "Autre";
}

function detecterCabinet(sujet, corps, from) {
  var texte = (sujet + " " + corps + " " + from).toLowerCase();
  for (var i = 0; i < CABINETS_CONNUS.length; i++) {
    if (texte.indexOf(CABINETS_CONNUS[i]) >= 0) return capitaliser(CABINETS_CONNUS[i]);
  }
  return "";
}

function estCabinet(nom) {
  if (!nom) return false;
  var n = nom.toLowerCase();
  return CABINETS_CONNUS.some(function(cab) { return n.indexOf(cab) >= 0; });
}

function nettoyerPoste(s) {
  if (!s) return "";
  return s.replace(/\(H\/F\)|\(F\/H\)|\(H\/F\/X\)|\(F\/H\/X\)/gi,"")
    .replace(/[\u00ab\u00bb\u201c\u201d\u2018\u2019\u0022]/g,"")
    .replace(/\s*[\u1F680\u1F31F\u2B50\uFE0F\u1F4BC\uD83C\uDFAF\u2728]+/g,"")
    .replace(/\s+/g," ").trim();
}

function nettoyerClient(s) {
  if (!s) return "A confirmer";
  var r = s.replace(/[\u00ab\u00bb\u201c\u201d\u2018\u2019\u0022]/g,"")
    .replace(/\(.*?\)/g,"").replace(/\s+/g," ").trim();
  return r || "A confirmer";
}

function normaliser(str) {
  if (!str) return "";
  return str.toString().toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
}

function capitaliser(str) {
  if (!str) return "";
  return str.split(" ").map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
}

function formatDateISO(date) {
  return Utilities.formatDate(date, "Europe/Paris", "yyyy-MM-dd'T'HH:mm");
}

function lireConfig(sheet) {
  var data = sheet.getDataRange().getValues();
  var config = {};
  for (var r = 1; r < data.length; r++) {
    if (data[r][0]) config[String(data[r][0])] = String(data[r][1]);
  }
  return config;
}

function ecrireConfig(sheet, key, value) {
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === key) { sheet.getRange(r + 1, 2).setValue(value); return; }
  }
  sheet.appendRow([key, value]);
}
