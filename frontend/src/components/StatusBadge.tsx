import Chip, { type ChipProps } from "@mui/material/Chip";

import type { PreviewStatus } from "../api.ts";

const colors: Record<PreviewStatus, ChipProps["color"]> = {
    running: "success",
    starting: "warning",
    failed: "error",
    stopped: "default",
};

export function StatusBadge({ status }: { status: PreviewStatus }) {
    return <Chip label={status} color={colors[status]} size="small" variant="outlined" />;
}
