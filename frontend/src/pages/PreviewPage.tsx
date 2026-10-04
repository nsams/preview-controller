import DeleteIcon from "@mui/icons-material/Delete";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import StopIcon from "@mui/icons-material/Stop";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";

import { describeRef, fetchPreview, fetchUsage, logsPath, runAction, UnauthorizedError, type PreviewAction, type PreviewDetails } from "../api.ts";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { ErrorMessage } from "../components/ErrorMessage.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { formatCpu, formatDuration, formatMemory } from "../format.ts";
import { usePolling } from "../usePolling.ts";

type ActionButton = { action: PreviewAction; label: string; icon: ReactNode; title?: string; isDanger?: boolean };

const startButton: ActionButton = {
    action: "start",
    label: "Start",
    icon: <PlayArrowIcon />,
    title: "Fetches the branch, rebuilds what changed and brings the preview up again.",
};

/** Which actions make sense in which state. */
function actionsFor(preview: PreviewDetails): ActionButton[] {
    switch (preview.status) {
        // A failed preview is never picked up again on its own, so start is the way out of it.
        case "failed":
            return [startButton];
        case "stopped":
            // Only a stopped preview can be deleted - while it runs, stopping it comes first.
            return [startButton, { action: "delete", label: "Delete", icon: <DeleteIcon />, isDanger: true }];
        case "running":
            return [
                {
                    action: "restart",
                    label: "Restart",
                    icon: <RestartAltIcon />,
                    title: "Fetches the branch, rebuilds what changed and recreates the containers - a restart pulls.",
                },
                { action: "stop", label: "Stop", icon: <StopIcon /> },
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
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

    const run = async (action: PreviewAction) => {
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

    const header = (
        <PageHeader title={slug} trail={[{ label: "Previews", href: "/" }]}>
            {preview.data ? <StatusBadge status={preview.data.status} /> : null}
            <Box sx={{ flex: 1 }} />
            <Button href={logsPath(slug)} size="small">
                Logs
            </Button>
        </PageHeader>
    );

    if (preview.error instanceof UnauthorizedError || (preview.error && !preview.data)) {
        return (
            <>
                {header}
                <ErrorMessage error={preview.error} />
            </>
        );
    }

    const data = preview.data;
    if (!data) {
        return (
            <>
                {header}
                <Paper variant="outlined" sx={{ p: 3 }}>
                    <Skeleton width="40%" height={48} />
                    <Skeleton />
                    <Skeleton />
                </Paper>
            </>
        );
    }

    const slugUsage = usage.data?.[slug];
    const facts: [string, ReactNode][] = [
        ["Repository", describeRef(data)],
        ["Commit", data.commit ? <code>{data.commit}</code> : "-"],
        ["Port", data.port ?? "-"],
        ["Uptime", formatDuration(data.startedAt)],
        ["Stopped", formatDuration(data.stoppedAt)],
        ["Last request", formatDuration(data.lastAccessAt)],
        ["CPU", formatCpu(slugUsage?.cpuPercent)],
        ["Memory", formatMemory(slugUsage?.memoryBytes)],
    ];
    const actions = actionsFor(data);

    return (
        <>
            {header}
            <Stack spacing={2}>
                {data.status === "starting" ? (
                    <Alert severity="info" icon={<CircularProgress size={20} />}>
                        Starting. The branch is fetched and the images are rebuilt, which can take a few minutes - this page updates on its own, and
                        the links already work.
                    </Alert>
                ) : null}
                {data.status === "failed" ? (
                    <Alert severity="error" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {data.error ?? "Unknown error"}
                    </Alert>
                ) : null}
                <ErrorMessage error={preview.error} />
                <ErrorMessage error={actionError} />

                <Paper variant="outlined" sx={{ p: 3 }}>
                    <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", mb: 3 }}>
                        {data.links.map((link, index) => (
                            <Button key={link.url} href={link.url} variant={index === 0 ? "contained" : "outlined"} endIcon={<OpenInNewIcon />}>
                                {link.name}
                            </Button>
                        ))}
                    </Stack>

                    <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 3, rowGap: 1, m: 0 }}>
                        {facts.map(([term, value]) => (
                            <Box key={term} sx={{ display: "contents" }}>
                                <Typography component="dt" variant="body2" color="text.secondary">
                                    {term}
                                </Typography>
                                <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                                    {value}
                                </Typography>
                            </Box>
                        ))}
                    </Box>

                    {actions.length > 0 ? (
                        <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
                            {actions.map((button) => (
                                <Tooltip key={button.action} title={button.title ?? ""}>
                                    <span>
                                        <Button
                                            variant="outlined"
                                            color={button.isDanger ? "error" : "inherit"}
                                            startIcon={button.icon}
                                            loading={runningAction === button.action}
                                            loadingPosition="start"
                                            disabled={runningAction !== undefined && runningAction !== button.action}
                                            onClick={() => (button.action === "delete" ? setIsConfirmingDelete(true) : run(button.action))}
                                        >
                                            {button.label}
                                        </Button>
                                    </span>
                                </Tooltip>
                            ))}
                        </Stack>
                    ) : null}
                </Paper>
            </Stack>

            <ConfirmDialog
                open={isConfirmingDelete}
                title={`Delete ${slug}?`}
                text="Its containers, volumes and checkout are removed, the next start builds everything again."
                confirmLabel="Delete"
                onConfirm={() => run("delete")}
                onClose={() => setIsConfirmingDelete(false)}
            />
        </>
    );
}
