import TerminalIcon from "@mui/icons-material/Terminal";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";

import { fetchContainerLog, fetchServices, fetchStartLog, type PreviewDetails, previewPath, type ServiceState } from "../api.ts";
import { usePolling } from "../usePolling.ts";
import { ErrorMessage } from "./ErrorMessage.tsx";
import { LogView } from "./LogView.tsx";

const tail = 200;

const tabColors: Record<ServiceState["status"], string | undefined> = {
    running: undefined,
    starting: "warning.main",
    failed: "error.main",
    stopped: undefined,
};

/**
 * Which log is shown, kept in the url: the start log without a parameter, the containers with
 * ?log=containers, a single service with ?service=<name> - which is what the old logs page used.
 */
type Selection = { source: "start" } | { source: "containers"; service?: string };

function readSelection(params: URLSearchParams): Selection {
    const service = params.get("service");
    if (service) {
        return { source: "containers", service };
    }
    return params.get("log") === "containers" ? { source: "containers" } : { source: "start" };
}

function selectionPath(slug: string, selection: Selection): string {
    if (selection.source === "start") {
        return previewPath(slug);
    }
    return selection.service ? `${previewPath(slug)}?service=${encodeURIComponent(selection.service)}` : `${previewPath(slug)}?log=containers`;
}

function tabValue(selection: Selection): string {
    return selection.source === "start" ? "start" : `service:${selection.service ?? ""}`;
}

/** The start log and the container logs of a preview as tabs of one card, the lower part of its detail page. */
export function PreviewLogs({ preview }: { preview: PreviewDetails }) {
    const { slug } = preview;
    const [searchParams] = useSearchParams();
    const selection = readSelection(searchParams);
    const { source } = selection;
    const service = selection.source === "containers" ? selection.service : undefined;
    const shown = tabValue(selection);

    // Only the log on screen is fetched, the services are needed for the tabs either way.
    const load = useCallback(async () => {
        const [services, log] = await Promise.all([
            fetchServices(slug),
            // The log failing is shown in its place, the tabs are still worth seeing.
            (source === "start" ? fetchStartLog(slug) : fetchContainerLog(slug, { tail, service })).then(
                (text) => ({ text, error: undefined }),
                (error: unknown) => ({ text: "", error }),
            ),
        ]);
        return { services, log, shown };
    }, [slug, source, service, shown]);

    // A preview that is still starting - or a container that is still crashing - is where the
    // interesting output is still coming in. Otherwise the log stays put while it is being read.
    const [isLive, setIsLive] = useState(true);
    const logs = usePolling(load, isLive ? 10_000 : 0);
    const data = logs.data;
    useEffect(() => {
        if (data) {
            setIsLive(preview.status === "starting" || data.services.some((candidate) => candidate.status === "failed"));
        }
    }, [data, preview.status]);

    if (!data) {
        return logs.error ? (
            <ErrorMessage error={logs.error} />
        ) : (
            <Paper variant="outlined" sx={{ p: 3 }}>
                <Skeleton height={200} variant="rounded" />
            </Paper>
        );
    }

    const { services } = data;
    // Right after switching tabs the previous log is still loaded, which is not shown under the new tab.
    const log = data.shown === shown ? data.log : undefined;
    // The preview as a whole still counts as running while one of its containers keeps crashing,
    // so the failing ones are called out above the log instead of only being coloured in.
    const failed = services.filter((candidate) => candidate.status === "failed");
    const emptyText =
        source === "start"
            ? "The controller has not started this preview yet."
            : preview.containerLogsSinceLastStart
              ? "No container output since the last start."
              : "No container output.";

    return (
        <Stack spacing={2}>
            <ErrorMessage error={logs.error} />

            <Paper variant="outlined" sx={{ p: 2.5 }}>
                <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
                    <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                        Logs
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    {isLive ? null : (
                        <Button size="small" onClick={logs.reload}>
                            Reload
                        </Button>
                    )}
                </Stack>

                {failed.length > 0 ? (
                    <Alert severity="error" sx={{ mb: 1.5 }}>
                        {failed.length === 1 ? "One container is not running" : `${failed.length} containers are not running`}:{" "}
                        {failed.map(({ name, detail }) => `${name} (${detail})`).join(", ")}.
                        {service ? "" : " Pick one below to see its output on its own."}
                    </Alert>
                ) : null}

                <Tabs
                    value={shown}
                    variant="scrollable"
                    allowScrollButtonsMobile
                    sx={{ minHeight: 40, borderBottom: 1, borderColor: "divider", "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}
                >
                    {/* What the controller did is a log of its own, set apart from the containers by a line. */}
                    <Tab
                        value="start"
                        label="Start log"
                        icon={<TerminalIcon fontSize="small" />}
                        iconPosition="start"
                        component={RouterLink}
                        to={selectionPath(slug, { source: "start" })}
                        sx={{ borderRight: 1, borderColor: "divider", mr: 1, fontWeight: 600 }}
                    />
                    <Tab value="service:" label="All containers" component={RouterLink} to={selectionPath(slug, { source: "containers" })} />
                    {services.map(({ name, status, detail }) => (
                        <Tab
                            key={name}
                            value={`service:${name}`}
                            // A service that is simply running needs no second label - only the others get one.
                            label={status === "running" ? name : `${name} · ${detail}`}
                            title={`${name}: ${detail}`}
                            component={RouterLink}
                            to={selectionPath(slug, { source: "containers", service: name })}
                            sx={{ color: tabColors[status], "&.Mui-selected": { color: tabColors[status] } }}
                            data-status={status}
                        />
                    ))}
                </Tabs>

                <Typography variant="body2" color="text.secondary" sx={{ my: 1.5 }}>
                    {source === "start"
                        ? "What the controller did on the last start: checkout, install and compose."
                        : `Container output, last ${tail} lines${preview.containerLogsSinceLastStart ? " since the last start" : ""}.`}
                </Typography>

                {log?.error ? (
                    <Box sx={{ mb: 1.5 }}>
                        <ErrorMessage error={log.error} />
                    </Box>
                ) : null}
                {log ? <LogView>{log.text.trim() || emptyText}</LogView> : <Skeleton height={120} variant="rounded" />}
            </Paper>
        </Stack>
    );
}
