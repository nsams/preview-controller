import { createTheme } from "@mui/material/styles";
import { forwardRef } from "react";
import { Link as RouterLink, type LinkProps as RouterLinkProps } from "react-router";

/**
 * Lets MUI links and buttons navigate through react-router when given an href, so that `<Link href>`
 * and `<Button href>` work for routes of the frontend. Absolute urls - the links into a preview -
 * are rendered as plain anchors by react-router.
 */
const LinkBehavior = forwardRef<HTMLAnchorElement, Omit<RouterLinkProps, "to"> & { href: RouterLinkProps["to"] }>(function LinkBehavior(
    { href, ...props },
    ref,
) {
    return <RouterLink ref={ref} to={href} {...props} />;
});

export const theme = createTheme({
    // Light or dark follows the system.
    colorSchemes: { light: true, dark: true },
    cssVariables: { colorSchemeSelector: "media" },
    components: {
        MuiLink: { defaultProps: { component: LinkBehavior } },
        MuiButtonBase: { defaultProps: { LinkComponent: LinkBehavior } },
    },
});
