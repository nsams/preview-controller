import { createDextinityTheme } from "@dextinity/admin";
import { forwardRef } from "react";
import { Link as RouterLink, type LinkProps as RouterLinkProps } from "react-router-dom";

/**
 * Lets MUI links and buttons navigate through react-router when given an href, so that `<Link href>`
 * and `<Button href>` work for routes of the frontend. Absolute urls - the links into a preview -
 * are rendered as plain anchors, react-router v5 would treat them as paths.
 */
const LinkBehavior = forwardRef<HTMLAnchorElement, Omit<RouterLinkProps, "to"> & { href: string }>(function LinkBehavior({ href, ...props }, ref) {
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
        return <a ref={ref} href={href} {...props} />;
    }
    return <RouterLink ref={ref} to={href} {...props} />;
});

export const theme = createDextinityTheme({
    components: {
        MuiLink: { defaultProps: { component: LinkBehavior } },
        MuiButtonBase: { defaultProps: { LinkComponent: LinkBehavior } },
    },
});
