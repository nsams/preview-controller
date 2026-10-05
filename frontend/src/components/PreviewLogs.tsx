import { Alert, FillSpace } from "@dextinity/admin";
import { Wrench } from "@dextinity/admin-icons";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { useCallback, useState } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";

import { containerLogStreamUrl, fetchServices, type PreviewDetails, previewPath, type ServiceState, startLogStreamUrl } from "../api.ts";
import { useLogStream } from "../useLogStream.ts";
import { usePolling } from "../usePolling.ts";
import { ErrorMessage } from "./ErrorMessage.tsx";
import { FollowSwitch, LogView } from "./LogView.tsx";

const tail = 200;

const tabColors: Record<ServiceState["status"], string | undefined> = {
    running: undefined,
    starting: "warning.main",
    failed: "error.main",
    stopped: undefined,
};

/**
 * Which log is shown, kept in the url: the start log without a parameter, the containers with
 * ?log=containers, a single service with ?service=<name>.
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
    const selection = readSelection(new URLSearchParams(useLocation().search));
    const { source } = selection;
    const service = selection.source === "containers" ? selection.service : undefined;
    const shown = tabValue(selection);

    // The log on screen is streamed, this only keeps the tabs and their states up to date.
    const load = useCallback(() => fetchServices(slug), [slug]);
    const services = usePolling(load, 5_000);

    // Compose follows the containers that are there when it starts, so a container log is opened
    // again whenever containers may have come or gone: when the preview changes its status, and
    // when a service starts running again - after a crash, say, or once the stream ended with the
    // containers. Not before the services are known, which would only open it twice.
    const restartKey = services.data
        ? [preview.status, ...services.data.filter((candidate) => candidate.status === "running").map(({ name }) => name)].join(" ")
        : undefined;
    const log = useLogStream(
        source === "start" ? startLogStreamUrl(slug) : restartKey === undefined ? undefined : containerLogStreamUrl(slug, { tail, service }),
        source === "start" ? undefined : restartKey,
    );
    const [follow, setFollow] = useState(true);

    if (!services.data) {
        return services.error ? (
            <ErrorMessage error={services.error} />
        ) : (
            <Paper variant="outlined" sx={{ p: 3 }}>
                <Skeleton height={200} variant="rounded" />
            </Paper>
        );
    }

    // The preview as a whole still counts as running while one of its containers keeps crashing,
    // so the failing ones are called out above the log instead of only being coloured in.
    const failed = services.data.filter((candidate) => candidate.status === "failed");
    const emptyText =
        source === "start"
            ? "The controller has not started this preview yet."
            : preview.containerLogsSinceLastStart
              ? "No container output since the last start."
              : "No container output.";

    return (
        <Stack spacing={2}>
            <ErrorMessage error={services.error} />

            <Paper variant="outlined" sx={{ p: 2.5 }}>
                <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
                    <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                        Logs
                    </Typography>
                    <FillSpace />
                    {source === "containers" ? (
                        <Typography variant="body2" color="text.secondary" data-testid="container-log-state">
                            {log.isConnected ? "live" : log.hasEnded ? "no container running" : ""}
                        </Typography>
                    ) : null}
                    <FollowSwitch follow={follow} onFollowChange={setFollow} />
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
                        icon={<Wrench />}
                        iconPosition="start"
                        component={RouterLink}
                        to={selectionPath(slug, { source: "start" })}
                        sx={{ borderRight: 1, borderColor: "divider", mr: 1, fontWeight: 600 }}
                    />
                    <Tab value="service:" label="All containers" component={RouterLink} to={selectionPath(slug, { source: "containers" })} />
                    {services.data.map(({ name, status, detail }) => (
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
                        : `Container output, from ${tail} lines back${preview.containerLogsSinceLastStart ? ", since the last start" : ""}.`}
                </Typography>

                {log.error ? (
                    <Box sx={{ mb: 1.5 }}>
                        <ErrorMessage error={log.error} />
                    </Box>
                ) : null}
                {log.text === undefined ? (
                    <Skeleton height={120} variant="rounded" />
                ) : (
                    <LogView follow={follow} onFollowChange={setFollow}>
                        {log.text.trim() || emptyText}
                    </LogView>
                )}
            </Paper>
        </Stack>
    );
}
