import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { type ContainerUsage, describeRef, type Preview, previewPath } from "../api.ts";
import { formatCpu, formatDuration, formatMemory } from "../format.ts";
import { StatusBadge } from "./StatusBadge.tsx";

export function PreviewsTable({ previews, usage }: { previews: Preview[]; usage?: Record<string, ContainerUsage> }) {
    if (previews.length === 0) {
        return (
            <Paper variant="outlined" sx={{ p: 3 }}>
                <Typography color="text.secondary">No previews yet.</Typography>
            </Paper>
        );
    }
    return (
        <TableContainer component={Paper} variant="outlined">
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>Repository</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Port</TableCell>
                        <TableCell align="right">Uptime</TableCell>
                        <TableCell align="right">Idle</TableCell>
                        <TableCell align="right">CPU</TableCell>
                        <TableCell align="right">Memory</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {previews.map((preview) => (
                        <TableRow key={preview.slug} hover>
                            <TableCell sx={{ wordBreak: "break-word" }}>
                                <Link href={previewPath(preview.slug)}>{describeRef(preview)}</Link>
                            </TableCell>
                            <TableCell>
                                <StatusBadge status={preview.status} />
                            </TableCell>
                            <TableCell align="right">{preview.port ?? "-"}</TableCell>
                            <TableCell align="right">{formatDuration(preview.startedAt)}</TableCell>
                            <TableCell align="right">{formatDuration(preview.lastAccessAt)}</TableCell>
                            <TableCell align="right">{formatCpu(usage?.[preview.slug]?.cpuPercent)}</TableCell>
                            <TableCell align="right">{formatMemory(usage?.[preview.slug]?.memoryBytes)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
