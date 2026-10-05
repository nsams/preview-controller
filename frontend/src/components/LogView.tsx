import Box from "@mui/material/Box";
import { useLayoutEffect, useRef } from "react";

/** How close to the bottom still counts as reading along. */
const stickyThreshold = 24;

/**
 * A block of log output that scrolls on its own instead of stretching the page. While it is
 * scrolled to the bottom it stays there as output comes in; scrolled up, it stays put.
 */
export function LogView({ children }: { children: string }) {
    const ref = useRef<HTMLPreElement>(null);
    const isAtBottom = useRef(true);

    useLayoutEffect(() => {
        const element = ref.current;
        if (element && isAtBottom.current) {
            element.scrollTop = element.scrollHeight;
        }
    }, [children]);

    return (
        <Box
            component="pre"
            ref={ref}
            onScroll={() => {
                const element = ref.current;
                if (element) {
                    isAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= stickyThreshold;
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
