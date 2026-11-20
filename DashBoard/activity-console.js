(() => {
    const storageKey = "dashboard.activity.v1";
    const limit = 200;
    const levels = { action: "Action", info: "Info", warn: "Avertissement", error: "Erreur" };
    let events = [];
    let stored = true;
    let pausedEvents = null;
    let render = () => {};

    try {
        const history = JSON.parse(localStorage.getItem(storageKey) || "[]");
        if (Array.isArray(history)) {
            events = history.filter(event => event && Object.hasOwn(levels, event.level)
                && Number.isFinite(event.time) && typeof event.source === "string"
                && typeof event.message === "string").slice(0, limit);
        }
    } catch {
        stored = false;
    }

    function redact(value) {
        return String(value).slice(0, 12000)
            .replace(/https?:\/\/[^\s"'<>]+/gi, raw => {
                try {
                    const url = new URL(raw);
                    url.username = "";
                    url.password = "";
                    url.search = "";
                    url.hash = "";
                    url.pathname = url.pathname.replace(/(\/calendars\/)[^/]+/g, "$1[masqué]");
                    return url.href;
                } catch { return "[adresse masquée]"; }
            })
            .replace(/\bBearer\s+[^\s"',}]+/gi, "Bearer [masqué]")
            .replace(/(["']?(?:[\w-]*(?:token|secret|password|authorization|api[_-]?key|code_verifier)[\w-]*)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi, "$1[masqué]");
    }

    function describe(value) {
        try {
            if (value && typeof value === "object" && typeof value.message === "string") {
                return redact(value.stack || `${value.name || "Erreur"}: ${value.message}`);
            }
            return redact(typeof value === "string" ? value : JSON.stringify(value));
        } catch { return "Détail impossible à lire."; }
    }

    function summarize(values) {
        return values.map(value => {
            const text = value && typeof value === "object" && typeof value.message === "string"
                ? `${value.name || "Erreur"}: ${value.message}` : describe(value);
            return redact(text || "").split(/\r?\n/)[0].trim().replace(/\s*:\s*$/, "");
        }).filter(Boolean).join(" · ").slice(0, 400);
    }

    function persist() {
        try {
            localStorage.setItem(storageKey, JSON.stringify(events));
            stored = true;
        } catch {
            stored = false;
        }
        if (!pausedEvents) render();
    }

    function record(level, source, message, operation = "", details = "") {
        const event = { time: Date.now(), level, source, message, operation, details: redact(details) };
        events.unshift(event);
        events.length = Math.min(events.length, limit);
        persist();
        return event;
    }

    let nextOperation = 0;
    window.dashboardActivity = {
        record,
        start(source, message) {
            const operation = `${Date.now().toString(36)}-${++nextOperation}`;
            const start = performance.now();
            record("action", source, message, operation);
            return (level, result, error) => record(level, source,
                `${result}${error ? " · " + summarize([error]) : ""} · ${Math.round(performance.now() - start)} ms`, operation, error ? describe(error) : "");
        }
    };

    const apiServices = new Map([
        ["api.open-meteo.com", "Météo"],
        ["api.spotify.com", "Spotify"],
        ["accounts.spotify.com", "Spotify"],
        ["www.googleapis.com", "Google"],
        ["api.themoviedb.org", "TMDB"],
        ["plan.naolib.fr", "Naolib"],
        ["open.tan.fr", "Naolib"]
    ]);
    const nativeFetch = window.fetch;
    window.fetch = async function (input, options) {
        let service = "Service réseau";
        let method = "REQUÊTE";
        let endpoint = "Adresse indisponible";
        try {
            const url = new URL(input instanceof Request ? input.url : input, document.baseURI);
            endpoint = redact(url.href);
            service = apiServices.get(url.hostname) ||
                (/\/api\/(?:states|services)(?:\/|$)/.test(url.pathname) ? "Home Assistant" :
                    url.origin === location.origin ? "Tableau de bord" : service);
            const verb = String(options?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
            if (/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(verb)) method = verb;
        } catch {
            // Let fetch handle invalid input as usual.
        }
        const start = performance.now();
        const log = (level, result, details = "") => record(level, "API",
            `${service} · ${method} · ${result} · ${Math.round(performance.now() - start)} ms`, "",
            `Service : ${service}\nMéthode : ${method}\nAdresse : ${endpoint}\nRésultat : ${result}\nDurée jusqu’à la réponse : ${Math.round(performance.now() - start)} ms\n${details}`);
        let response;
        try {
            response = await nativeFetch.call(window, input, options);
        } catch (error) {
            if (error?.name === "AbortError") log("info", "Annulé", describe(error));
            else log("error", `Échec réseau · ${summarize([error])}`,
                `${describe(error)}\nAucune réponse HTTP reçue. Le navigateur ne permet pas de distinguer ici une coupure réseau, un refus CORS ou un problème de certificat.`);
            throw error;
        }
        const idleSpotify = service === "Spotify" && response.status === 404
            && response.url === "https://api.spotify.com/v1/me/player";
        const explanations = {
            400: "Le serveur refuse les paramètres de la requête.",
            401: "L’authentification est absente, invalide ou expirée.",
            403: "Le serveur refuse l’accès à cette ressource.",
            404: "La ressource demandée est introuvable.",
            408: "Le serveur a interrompu la requête après expiration du délai.",
            429: "La limite d’appels autorisés a été atteinte.",
            500: "Le serveur a rencontré une erreur interne.",
            502: "La passerelle a reçu une réponse invalide du serveur.",
            503: "Le service est temporairement indisponible.",
            504: "La passerelle a attendu trop longtemps la réponse du serveur."
        };
        const entry = log(response.ok || idleSpotify || !response.status ? "info" : "error",
            response.status ? `HTTP ${response.status}${!response.ok && !idleSpotify && explanations[response.status] ? " · " + explanations[response.status] : ""}` : "Statut indisponible",
            `${redact(response.statusText || "")}\n${idleSpotify ? "Aucun lecteur Spotify actif." : explanations[response.status] || ""}`);
        if (!response.ok && !idleSpotify && response.body) {
            // Read only a small diagnostic excerpt from a clone, without delaying the caller.
            const capture = async () => {
                const reader = response.clone().body.getReader();
                const timer = setTimeout(() => { reader.cancel().catch(() => {}); }, 3000);
                try {
                    const decoder = new TextDecoder();
                    let excerpt = "";
                    let bytes = 0;
                    while (bytes < 4096) {
                        const chunk = await reader.read();
                        if (chunk.done) break;
                        const portion = chunk.value.subarray(0, 4096 - bytes);
                        bytes += portion.length;
                        excerpt += decoder.decode(portion, { stream: true });
                    }
                    excerpt += decoder.decode();
                    if (excerpt && events.includes(entry)) {
                        entry.details += "\n\nRéponse du serveur (extrait limité) :\n" + redact(excerpt);
                        persist();
                    }
                } finally {
                    clearTimeout(timer);
                    reader.cancel().catch(() => {});
                }
            };
            capture().catch(() => {});
        }
        return response;
    };

    for (const level of ["warn", "error"]) {
        const original = console[level];
        console[level] = function (label, ...details) {
            original.call(this, label, ...details);
            const summary = summarize([label, ...details]) ||
                (level === "error" ? "Erreur sans message fourni par l’application" : "Avertissement sans message fourni");
            record(level, "Application", summary, "", [label, ...details].map(describe).join("\n\n"));
        };
    }

    window.addEventListener("error", event => {
        record("error", "Navigateur", summarize([event.error || event.message]) ||
            `Échec du chargement de ${redact(event.target?.src || event.target?.href || "ressource inconnue")}`, "",
            `${event.error ? describe(event.error) : redact(event.message || "Chargement de ressource échoué")}\nFichier : ${redact(event.filename || event.target?.src || event.target?.href || "inconnu")}\nLigne : ${event.lineno || "inconnue"} · Colonne : ${event.colno || "inconnue"}`);
    }, true);
    window.addEventListener("unhandledrejection", event => {
        record("error", "Navigateur", summarize([event.reason]) || "Échec asynchrone sans message fourni", "", describe(event.reason));
    });

    document.addEventListener("DOMContentLoaded", () => {
        const page = document.getElementById("activity-console");
        const filters = page.querySelector("form");
        const list = page.querySelector(".activity-events");
        const status = page.querySelector(".activity-status");
        const pause = page.querySelector(".activity-pause");
        const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium" });
        const normalize = value => value.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "");
        let selected = new Set();

        render = () => {
            if (page.style.display === "none") return;
            const { query, level, source, period } = filters.elements;
            const history = pausedEvents || events;
            const search = normalize(query.value.trim());
            const cutoff = period.value ? Date.now() - Number(period.value) * 3600000 : 0;
            const matches = history.filter(event =>
                (!level.value || level.value === event.level) &&
                (!source.value || source.value === event.source) &&
                event.time >= cutoff &&
                normalize(`${event.message} ${event.source} ${event.operation || ""} ${typeof event.details === "string" ? event.details : ""}`).includes(search)
            );

            status.textContent = `${pausedEvents ? "En pause" : "En direct"} · ${matches.length} événement(s)${stored ? "" : " · historique en mémoire uniquement"}`;
            pause.textContent = pausedEvents ? "Reprendre" : "Pause";
            const rows = matches.map(event => {
                const row = document.createElement("details");
                row.className = "activity-event";
                row.open = selected.has(event);
                row.dataset.level = event.level;
                const title = document.createElement("summary");
                const legacySummary = ["Erreur signalée par l’application", "Avertissement de l’application",
                    "Échec asynchrone non pris en charge"].includes(event.message);
                const message = legacySummary && typeof event.details === "string" && event.details
                    ? summarize([event.details]) : event.message;
                title.textContent = `${date.format(event.time)} · ${levels[event.level]} · ${message}`;
                const detail = document.createElement("div");
                detail.textContent = `Source : ${event.source}`;
                row.append(title, detail);
                const diagnostic = document.createElement("pre");
                diagnostic.className = "activity-diagnostic";
                diagnostic.textContent = typeof event.details === "string" && event.details
                    ? event.details : "Cet événement ne contient pas de diagnostic supplémentaire. Les anciens événements ont été enregistrés avant l’ajout des détails.";
                row.append(diagnostic);
                if (event.operation) {
                    const related = document.createElement("button");
                    related.type = "button";
                    related.textContent = `Voir l’opération ${event.operation}`;
                    related.addEventListener("click", () => {
                        filters.reset();
                        query.value = event.operation;
                        render();
                        query.focus();
                    });
                    detail.append(" · ", related);
                }
                title.addEventListener("click", () => {
                    if (row.open) selected.delete(event);
                    else selected.add(event);
                });
                return row;
            });
            selected = new Set([...selected].filter(event => history.includes(event)));
            list.replaceChildren(...rows);
            if (!matches.length) list.textContent = "Aucun événement ne correspond aux filtres.";
        };

        filters.addEventListener("input", render);
        filters.addEventListener("submit", event => event.preventDefault());
        pause.addEventListener("click", () => {
            pausedEvents = pausedEvents ? null : [...events];
            render();
        });
        page.addEventListener("activityopen", render);
    });
})();
