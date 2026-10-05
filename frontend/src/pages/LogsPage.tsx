import { Alert, Button, FillSpace } from "@dextinity/admin";
import Box from "@mui/material/Box";
import Chip, { type ChipProps } from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useLocation, useParams } from "react-router-dom";

import { fetchContainerLog, fetchPreview, fetchServices, fetchStartLog, logsPath, previewPath, type ServiceState } from "../api.ts";
import { ErrorMessage } from "../components/ErrorMessage.tsx";
import { LogView } from "../components/LogView.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { usePolling } from "../usePolling.ts";

const tail = 200;

const chipColors: Record<ServiceState["status"], ChipProps["color"]> = {
    running: "default",
    starting: "warning",
    failed: "error",
    stopped: "default",
};

export function LogsPage() {
    const { slug } = useParams<{ slug: string }>();
    const service = new URLSearchParams(useLocation().search).get("service") ?? undefined;

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

    const { preview, services, startLog, containerLog } = data;
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
                    <LogView>{startLog.trim() || "The controller has not started this preview yet."}</LogView>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2.5 }}>
                    <Stack direction="row" sx={{ alignItems: "baseline", mb: 1.5 }}>
                        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                            Containers
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                            last {tail} lines{preview.containerLogsSinceLastStart ? " since the last start" : ""}
                        </Typography>
                        <FillSpace />
                        {isLive ? null : (
                            <Button variant="textDark" onClick={logs.reload}>
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
