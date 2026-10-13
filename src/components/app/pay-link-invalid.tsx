import { EmptyState } from "@/components/gate";

import { LinkButton } from "./link-button";

export interface PayLinkInvalidProps {
  title: string;
  description: string;
  homeLabel: string;
  href?: string;
}

/**
 * Shared invalid / expired-link panel. Rendered by both the route's
 * `not-found.tsx` boundary and the pay client when the API returns 404.
 */
export function PayLinkInvalid({
  title,
  description,
  homeLabel,
  href = "/",
}: PayLinkInvalidProps) {
  return (
    <EmptyState
      title={title}
      description={description}
      action={
        <LinkButton href={href} variant="secondary">
          {homeLabel}
        </LinkButton>
      }
    />
  );
}
