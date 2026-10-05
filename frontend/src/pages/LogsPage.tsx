import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip, { type ChipProps } from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useCallback } from "react";
import { Link as RouterLink, useParams, useSearchParams } from "react-router";

import { containerLogStreamUrl, fetchPreview, fetchServices, logsPath, previewPath, type ServiceState, startLogStreamUrl } from "../api.ts";
import { ErrorMessage } from "../components/ErrorMessage.tsx";
import { LogView } from "../components/LogView.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { useLogStream } from "../useLogStream.ts";
import { usePolling } from "../usePolling.ts";

const tail = 200;

const chipColors: Record<ServiceState["status"], ChipProps["color"]> = {
    running: "default",
    starting: "warning",
    failed: "error",
    stopped: "default",
};

export function LogsPage() {
    const slug = useParams().slug ?? "";
    const service = useSearchParams()[0].get("service") ?? undefined;

    // The logs themselves are streamed, this only keeps the status and the services up to date.
    const load = useCallback(async () => {
        const [preview, services] = await Promise.all([fetchPreview(slug), fetchServices(slug)]);
        return { preview, services };
    }, [slug]);
    const logs = usePolling(load, 5_000);
    const data = logs.data;

    const startLog = useLogStream(startLogStreamUrl(slug));
    // Compose follows the containers that are there when it starts, so the stream is opened again
    // whenever containers may have come or gone: when the preview changes its status, and when a
    // service starts running again - after a crash, say, or once the stream ended with the
    // containers. Not before the status is known, which would only open it twice.
    const restartKey = data
        ? [data.preview.status, ...data.services.filter((candidate) => candidate.status === "running").map(({ name }) => name)].join(" ")
        : undefined;
    const containerLog = useLogStream(restartKey === undefined ? undefined : containerLogStreamUrl(slug, { tail, service }), restartKey);

    const header = (
        <PageHeader
            title="Logs"
            trail={[
                { label: "Previews", href: "/" },
                { label: slug, href: previewPath(slug) },
            ]}
        >
            {data ? <StatusBadge status={data.preview.status} /> : null}
        </PageHeader>
    );

    if (!data) {
        return (
            <>
                {header}
                {logs.error ? (
                    <ErrorMessage error={logs.error} />
                ) : (
                    <Paper variant="outlined" sx={{ p: 3 }}>
                        <Skeleton height={200} variant="rounded" />
                    </Paper>
                )}
            </>
        );
    }

    const { preview, services } = data;
    // The preview as a whole still counts as running while one of its containers keeps crashing,
    // so the failing ones are called out above the log instead of only being coloured in.
    const failed = services.filter((candidate) => candidate.status === "failed");

    return (
        <>
            {header}
            <Stack spacing={2}>
                <ErrorMessage error={logs.error} />

                <Paper variant="outlined" sx={{ p: 2.5 }}>
                    <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1.5 }}>
                        Start log
                    </Typography>
                    <LogView>{startLog.text.trim() || "The controller has not started this preview yet."}</LogView>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2.5 }}>
                    <Stack direction="row" sx={{ alignItems: "baseline", mb: 1.5 }}>
                        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                            Containers
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                            from {tail} lines back{preview.containerLogsSinceLastStart ? ", since the last start" : ""}
                        </Typography>
                        <Box sx={{ flex: 1 }} />
                        <Typography variant="body2" color="text.secondary" data-testid="container-log-state">
                            {containerLog.isConnected ? "live" : containerLog.hasEnded ? "no container running" : ""}
                        </Typography>
                    </Stack>

                    {failed.length > 0 ? (
                        <Alert severity="error" sx={{ mb: 1.5 }}>
                            {failed.length === 1 ? "One container is not running" : `${failed.length} containers are not running`}:{" "}
                            {failed.map(({ name, detail }) => `${name} (${detail})`).join(", ")}.
                            {service ? "" : " Pick one below to see its output on its own."}
                        </Alert>
                    ) : null}

                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5 }}>
                        <Chip
                            label="all services"
                            component={RouterLink}
                            to={logsPath(slug)}
                            clickable
                            color={service ? "default" : "primary"}
                            variant={service ? "outlined" : "filled"}
                        />
                        {services.map(({ name, status, detail }) => (
                            <Chip
                                key={name}
                                // A service that is simply running needs no second label - only the others get one.
                                label={status === "running" ? name : `${name} · ${detail}`}
                                title={`${name}: ${detail}`}
                                component={RouterLink}
                                to={logsPath(slug, name)}
                                clickable
                                color={service === name && status === "running" ? "primary" : chipColors[status]}
                                variant={service === name ? "filled" : "outlined"}
                                data-status={status}
                            />
                        ))}
                    </Stack>

                    {containerLog.error ? (
                        <Box sx={{ mb: 1.5 }}>
                            <ErrorMessage error={containerLog.error} />
                        </Box>
                    ) : null}
                    <LogView>
                        {containerLog.text.trim() ||
                            (preview.containerLogsSinceLastStart ? "No container output since the last start." : "No container output.")}
                    </LogView>
                </Paper>
            </Stack>
        </>
    );
}
