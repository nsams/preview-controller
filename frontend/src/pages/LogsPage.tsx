import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { describeRef, fetchContainerLog, fetchPreview, fetchServices, fetchStartLog, logsPath, previewPath } from "../api.ts";
import { ErrorMessage } from "../components/ErrorMessage.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { usePolling } from "../usePolling.ts";

const tail = 200;

export function LogsPage() {
    const slug = useParams().slug ?? "";
    const service = useSearchParams()[0].get("service") ?? undefined;

    const load = useCallback(async () => {
        const [preview, services, startLog, containerLog] = await Promise.all([
            fetchPreview(slug),
            fetchServices(slug),
            fetchStartLog(slug),
            // The container log failing is shown in its place, the rest of the page is still worth seeing.
            fetchContainerLog(slug, { tail, service }).then(
                (text) => ({ text, error: undefined }),
                (error: unknown) => ({ text: "", error }),
            ),
        ]);
        return { preview, services, startLog, containerLog };
    }, [slug, service]);

    // A preview that is still starting - or a container that is still crashing - is where the
    // interesting output is still coming in. Otherwise the log stays put while it is being read.
    const [isLive, setIsLive] = useState(true);
    const logs = usePolling(load, isLive ? 10_000 : 0);
    const data = logs.data;
    useEffect(() => {
        if (data) {
            setIsLive(data.preview.status === "starting" || data.services.some((candidate) => candidate.status === "failed"));
        }
    }, [data]);

    if (!data) {
        return (
            <>
                <h1>Logs</h1>
                <p className="lead">
                    <Link to="/">all previews</Link> &middot; <Link to={previewPath(slug)}>{slug}</Link>
                </p>
                {logs.error ? <ErrorMessage error={logs.error} /> : <p>Loading…</p>}
            </>
        );
    }

    const { preview, services, startLog, containerLog } = data;
    // The preview as a whole still counts as running while one of its containers keeps crashing,
    // so the failing ones are called out above the log instead of only being coloured in.
    const failed = services.filter((candidate) => candidate.status === "failed");

    return (
        <>
            <h1>Logs</h1>
            <p className="lead">
                <Link to="/">all previews</Link> &middot; <Link to={previewPath(slug)}>{slug}</Link> &middot; {describeRef(preview)} &middot;{" "}
                <StatusBadge status={preview.status} />
            </p>
            <ErrorMessage error={logs.error} />
            <div className="card">
                <h2>Start log</h2>
                <pre>{startLog.trim() || "The controller has not started this preview yet."}</pre>
                <h2>
                    Containers (last {tail} lines{preview.containerLogsSinceLastStart ? " since the last start" : ""})
                </h2>
                {failed.length > 0 ? (
                    <p className="error">
                        {failed.length === 1 ? "One container is not running" : `${failed.length} containers are not running`}:{" "}
                        {failed.map(({ name, detail }) => `${name} (${detail})`).join(", ")}.
                        {service ? "" : " Pick one below to see its output on its own."}
                    </p>
                ) : null}
                <div className="filters">
                    <Link to={logsPath(slug)} aria-current={service ? undefined : "page"}>
                        all services
                    </Link>
                    {services.map(({ name, status, detail }) => (
                        <Link
                            key={name}
                            to={logsPath(slug, name)}
                            className={`chip-${status}`}
                            title={`${name}: ${detail}`}
                            aria-current={service === name ? "page" : undefined}
                        >
                            {name}
                            {/* A service that is simply running needs no second label - only the others get one. */}
                            {status === "running" ? null : <span className="chip-state">{detail}</span>}
                        </Link>
                    ))}
                </div>
                <ErrorMessage error={containerLog.error} />
                <pre>
                    {containerLog.text.trim() ||
                        (preview.containerLogsSinceLastStart ? "No container output since the last start." : "No container output.")}
                </pre>
            </div>
        </>
    );
}
