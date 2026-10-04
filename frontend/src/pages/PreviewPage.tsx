import { useCallback, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { describeRef, fetchPreview, fetchUsage, logsPath, runAction, UnauthorizedError, type PreviewAction, type PreviewDetails } from "../api.ts";
import { ErrorMessage } from "../components/ErrorMessage.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { formatCpu, formatDuration, formatMemory } from "../format.ts";
import { usePolling } from "../usePolling.ts";

type ActionButton = { action: PreviewAction; label: string; title?: string; confirm?: string; isDanger?: boolean };

/** Which actions make sense in which state. */
function actionsFor(preview: PreviewDetails): ActionButton[] {
    switch (preview.status) {
        // A failed preview is never picked up again on its own, so start is the way out of it.
        case "failed":
            return [{ action: "start", label: "Start", title: "Fetches the branch, rebuilds what changed and brings the preview up again." }];
        case "stopped":
            return [
                { action: "start", label: "Start", title: "Fetches the branch, rebuilds what changed and brings the preview up again." },
                // Only a stopped preview can be deleted - while it runs, stopping it comes first.
                {
                    action: "delete",
                    label: "Delete",
                    isDanger: true,
                    confirm: `Delete ${preview.slug}? Its containers, volumes and checkout are removed, the next start builds everything again.`,
                },
            ];
        case "running":
            return [
                {
                    action: "restart",
                    label: "Restart",
                    title: "Fetches the branch, rebuilds what changed and recreates the containers - a restart pulls.",
                },
                { action: "stop", label: "Stop" },
            ];
        case "starting":
            return [];
    }
}

export function PreviewPage() {
    const slug = useParams().slug ?? "";
    const navigate = useNavigate();
    const loadPreview = useCallback(() => fetchPreview(slug), [slug]);
    const preview = usePolling(loadPreview, 5_000);
    const usage = usePolling(fetchUsage, 10_000);
    const [actionError, setActionError] = useState<unknown>();
    const [runningAction, setRunningAction] = useState<PreviewAction>();

    const run = async ({ action, confirm }: ActionButton) => {
        if (confirm && !window.confirm(confirm)) {
            return;
        }
        setRunningAction(action);
        setActionError(undefined);
        try {
            await runAction(slug, action);
            if (action === "delete") {
                // There is no page left to come back to.
                navigate("/");
                return;
            }
            preview.reload();
        } catch (error) {
            setActionError(error);
        }
        setRunningAction(undefined);
    };

    if (preview.error instanceof UnauthorizedError || (preview.error && !preview.data)) {
        return (
            <>
                <h1>{slug}</h1>
                <p className="lead">
                    <Link to="/">all previews</Link>
                </p>
                <ErrorMessage error={preview.error} />
            </>
        );
    }

    const data = preview.data;
    const slugUsage = usage.data?.[slug];
    const facts: [string, ReactNode][] = data
        ? [
              ["Status", <StatusBadge status={data.status} />],
              ["Repository", describeRef(data)],
              ["Commit", data.commit ? <code>{data.commit}</code> : "-"],
              ["Port", data.port ?? "-"],
              ["Uptime", formatDuration(data.startedAt)],
              ["Stopped", formatDuration(data.stoppedAt)],
              ["Last request", formatDuration(data.lastAccessAt)],
              ["CPU", formatCpu(slugUsage?.cpuPercent)],
              ["Memory", formatMemory(slugUsage?.memoryBytes)],
          ]
        : [];
    const actions = data ? actionsFor(data) : [];

    return (
        <>
            <h1>{slug}</h1>
            <p className="lead">
                <Link to="/">all previews</Link> &middot; <Link to={logsPath(slug)}>logs</Link>
            </p>
            <div className="card">
                {!data ? (
                    <p>Loading…</p>
                ) : (
                    <>
                        {data.status === "starting" ? (
                            <div className="starting">
                                <Spinner />
                                <span>
                                    Starting. The branch is fetched and the images are rebuilt, which can take a few minutes - this page updates on
                                    its own, and the links already work.
                                </span>
                            </div>
                        ) : null}
                        {data.status === "failed" ? <p className="error">{data.error ?? "Unknown error"}</p> : null}
                        <ErrorMessage error={preview.error} />
                        <ErrorMessage error={actionError} />
                        <div className="link-buttons">
                            {data.links.map((link) => (
                                <a key={link.url} href={link.url}>
                                    {link.name}
                                </a>
                            ))}
                        </div>
                        <dl className="facts">
                            {facts.map(([term, value]) => (
                                <div key={term} className="fact">
                                    <dt>{term}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                        </dl>
                        {actions.length > 0 ? (
                            <div className="actions">
                                {actions.map((button) => (
                                    <button
                                        key={button.action}
                                        type="button"
                                        className={button.isDanger ? "danger" : undefined}
                                        title={button.title}
                                        disabled={runningAction !== undefined}
                                        onClick={() => run(button)}
                                    >
                                        {runningAction === button.action ? `${button.label}…` : button.label}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </>
                )}
            </div>
        </>
    );
}
