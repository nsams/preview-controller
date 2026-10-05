import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import { useLayoutEffect, useRef } from "react";

/** How close to the bottom still counts as being at the end of the log. */
const bottomThreshold = 24;

type LogViewProps = {
    children: string;
    /** Whether the view keeps scrolling to the end as output comes in. */
    follow: boolean;
    /** Scrolling up stops following, scrolling back down to the end picks it up again. */
    onFollowChange: (follow: boolean) => void;
};

/** A block of log output that scrolls on its own instead of stretching the page. */
export function LogView({ children, follow, onFollowChange }: LogViewProps) {
    const ref = useRef<HTMLPreElement>(null);

    // Also runs when following is switched on, which jumps to the end right away.
    useLayoutEffect(() => {
        const element = ref.current;
        if (element && follow) {
            element.scrollTop = element.scrollHeight;
        }
    }, [children, follow]);

    return (
        <Box
            component="pre"
            ref={ref}
            onScroll={() => {
                const element = ref.current;
                if (element) {
                    const isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= bottomThreshold;
                    if (isAtBottom !== follow) {
                        onFollowChange(isAtBottom);
                    }
                }
            }}
            sx={{
                m: 0,
                p: 1.5,
                maxHeight: "60vh",
                overflow: "auto",
                borderRadius: 1,
                border: 1,
                borderColor: "divider",
                bgcolor: "action.hover",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
                lineHeight: 1.45,
            }}
        >
            {children}
        </Box>
    );
}

/** The switch that goes with a LogView, for the header above it. */
export function FollowSwitch({ follow, onFollowChange }: Pick<LogViewProps, "follow" | "onFollowChange">) {
    return (
        <FormControlLabel
            label="Follow"
            control={<Switch size="small" checked={follow} onChange={(event) => onFollowChange(event.target.checked)} />}
            slotProps={{ typography: { variant: "body2" } }}
            sx={{ mr: 0, ml: 1 }}
        />
    );
}
