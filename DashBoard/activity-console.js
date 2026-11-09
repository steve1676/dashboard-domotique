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

    function record(level, source, message, operation = "") {
        events.unshift({ time: Date.now(), level, source, message, operation });
        events.length = Math.min(events.length, limit);
        try {
            localStorage.setItem(storageKey, JSON.stringify(events));
            stored = true;
        } catch {
            stored = false;
        }
        if (!pausedEvents) render();
    }

    let nextOperation = 0;
    window.dashboardActivity = {
        record,
        start(source, message) {
            const operation = `${Date.now().toString(36)}-${++nextOperation}`;
            record("action", source, message, operation);
            return (level, result) => record(level, source, result, operation);
        }
    };

    for (const level of ["warn", "error"]) {
        const original = console[level];
        console[level] = function (label, ...details) {
            original.call(this, label, ...details);
            // Keep diagnostic labels. Raw error objects, URLs and payloads stay out of storage.
            const summary = typeof label === "string" && /^[\p{L}\p{N} .,[\]()'’_-]{1,110}\s*:\s*$/u.test(label)
                ? label.trim().replace(/\s*:\s*$/, "")
                : level === "error" ? "Erreur signalée par l’application" : "Avertissement de l’application";
            record(level, "Application", summary);
        };
    }

    window.addEventListener("error", event => {
        record("error", "Navigateur", Number.isInteger(event.lineno) && event.lineno > 0
            ? `Erreur JavaScript à la ligne ${event.lineno}`
            : "Erreur de chargement ou d’exécution");
    }, true);
    window.addEventListener("unhandledrejection", () => {
        record("error", "Navigateur", "Échec asynchrone non pris en charge");
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
                normalize(`${event.message} ${event.source} ${event.operation || ""}`).includes(search)
            );

            status.textContent = `${pausedEvents ? "En pause" : "En direct"} · ${matches.length} événement(s)${stored ? "" : " · historique en mémoire uniquement"}`;
            pause.textContent = pausedEvents ? "Reprendre" : "Pause";
            const rows = matches.map(event => {
                const row = document.createElement("details");
                row.className = "activity-event";
                row.open = selected.has(event);
                row.dataset.level = event.level;
                const title = document.createElement("summary");
                title.textContent = `${date.format(event.time)} · ${levels[event.level]} · ${event.message}`;
                const detail = document.createElement("div");
                detail.textContent = `Source : ${event.source}`;
                row.append(title, detail);
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
